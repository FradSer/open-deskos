'use strict'

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { createJsonLineReader } = require('./json-line-reader')
const { createBridgePluginRuntime, respondRuntimeDiagnosis, resolveBridgeControlEndpoint } = require('./plugin-runtime')
const {
  createLinkState,
  encodeJsonLine,
  parseJsonLine,
  validateNavigate,
  validateRemoteInput,
  validateShellState,
} = require('./protocol')

const SOCKET_DIRECTORY = 'odk-remote'
const SOCKET_NAME = 'bridge.sock'

class RemoteBridge {
  constructor({ adapter, socketPath = resolveSocketPath(), logger = console, replacementPlugins = [], disabled = [] } = {}) {
    if (!adapter) throw new Error('RemoteBridge requires a Remote Link adapter')
    this.adapter = adapter
    this.socketPath = socketPath
    this.logger = logger
    this.server = null
    this.clients = new Set()
    this.latestShellState = null
    this.linkState = createLinkState('disconnected')
    this.activeTransport = null
    this.started = false
    this.generation = 0
    this.linkRevision = 0
    this.ownsSocket = false
    this.runtime = createBridgePluginRuntime({
      controlEndpoint: resolveBridgeControlEndpoint(socketPath),
      transports: [adapter],
      replacementPlugins,
      disabled,
      onTransportCreated: (_previous, actual) => { this.adapter = actual },
      logger,
      initialize: false,
      open: (signal) => this.#open(signal),
      close: () => this.#close(),
      handlers: {
        connected: (transport, details) => this.#onAdapterConnected(details),
        disconnected: (transport, details) => this.#onAdapterDisconnected(details),
        message: (_transport, record) => this.#onAdapterMessage(record),
        'adapter-error': (_transport, error) => this.logger.error('Remote Link adapter error', error),
      },
      withdrawn: () => this.#onAdapterDisconnected(),
    })
  }

  async start() {
    const epoch = this.generation
    const catalog = await this.runtime.host.start()
    if (epoch !== this.generation) return
    const failed = catalog.find(entry => entry.manifest.id === this.runtime.listenerId && entry.state !== 'running')
    const adapterFailure = catalog.find(entry => entry.manifest.kind === 'transport'
      && ['failed', 'cleanup-failed', 'cleanup-blocked'].includes(entry.state))
    if (adapterFailure) {
      await this.stop()
      throw this.runtime.errors.get(adapterFailure.manifest.id) || Error(adapterFailure.error)
    }
    if (failed) {
      await this.stop()
      throw this.runtime.errors.get(failed.manifest.id) || Error(failed.error || 'Remote Bridge startup cancelled')
    }
  }

  async stop() {
    this.generation++
    this.linkRevision++
    this.started = false
    await this.runtime.host.stop()
    this.activeTransport = null

    this.linkState = createLinkState('disconnected')
  }

  pluginCatalog() { return this.runtime.host.list() }

  setTransportEnabled(id, enabled) { return this.runtime.setEnabled(id, enabled) }

  async #open(signal) {
    await fs.promises.mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 })
    if (signal.aborted) return
    await removeStaleSocket(this.socketPath)
    if (signal.aborted) return
    this.server = net.createServer((socket) => this.#attachClient(socket))
    await listen(this.server, this.socketPath)
    this.ownsSocket = true
    await fs.promises.chmod(this.socketPath, 0o600)
    this.started = !signal.aborted
  }

  async #close() {
    this.started = false
    for (const client of this.clients) client.destroy()
    this.clients.clear()
    if (this.server) {
      const server = this.server
      if (server.listening) await closeServer(server)
      this.server = null
    }
    if (this.ownsSocket) {
      await removeSocketIfPresent(this.socketPath)
      this.ownsSocket = false
    }
  }

  #attachClient(socket) {
    this.clients.add(socket)
    socket.write(encodeJsonLine(this.linkState))
    const reader = createJsonLineReader((line) => this.#onClientLine(line, socket))
    socket.on('data', (chunk) => reader.push(chunk))
    socket.once('end', () => reader.end())
    socket.once('close', () => this.clients.delete(socket))
    socket.once('error', () => this.clients.delete(socket))
  }

  async #onClientLine(line, socket) {
    const parsed = parseJsonLine(line)
    if (!parsed.ok) return
    if (respondRuntimeDiagnosis(socket, parsed.record, () => this.pluginCatalog())) return
    const validation = validateShellState(parsed.record)
    if (!validation.ok) return
    const changed = JSON.stringify(this.latestShellState) !== JSON.stringify(parsed.record)
    this.latestShellState = parsed.record
    if (changed && this.activeTransport) await this.#synchronizeActiveLink()
  }

  async #onAdapterConnected({ transport }) {
    if (!this.started) return
    this.linkRevision++
    this.activeTransport = transport
    this.#publishLinkState('syncing')
    await this.#synchronizeActiveLink()
  }

  #onAdapterDisconnected({ transport, reason } = {}) {
    if (!this.started) return
    if (transport && transport !== this.activeTransport) return
    this.linkRevision++
    this.activeTransport = null
    this.#publishLinkState('disconnected')
  }

  #onAdapterMessage(record) {
    if (!validateNavigate(record).ok && !validateRemoteInput(record).ok) return
    this.#broadcast(record)
  }

  async #synchronizeActiveLink() {
    if (!this.activeTransport || !this.latestShellState) return
    const revision = this.linkRevision
    const epoch = this.generation
    try {
      await this.adapter.send(createAdapterState(this.latestShellState, this.activeTransport))
    } catch (error) {
      this.logger.error('Remote Link state synchronization failed', error)
      return
    }
    if (this.started && epoch === this.generation && revision === this.linkRevision && this.activeTransport && this.runtime.isAvailable(this.adapter)) this.#publishLinkState(linkStateForTransport(this.activeTransport))
  }

  #publishLinkState(state) {
    this.linkState = createLinkState(state)
    this.#broadcast(this.linkState)
  }

  #broadcast(record) {
    const line = encodeJsonLine(record)
    for (const client of this.clients) {
      if (client.destroyed || !client.write(line)) continue
    }
  }
}

function createAdapterState(shellState, transport) {
  return {
    ...shellState,
    link: transport === 'usb-cdc' ? 'wired' : 'wireless',
  }
}

function linkStateForTransport(transport) {
  return transport === 'usb-cdc' ? 'usb' : 'wireless'
}

function resolveSocketPath(env = process.env) {
  if (!env.XDG_RUNTIME_DIR || !path.isAbsolute(env.XDG_RUNTIME_DIR)) {
    throw new Error('XDG_RUNTIME_DIR must be an absolute path for Remote Bridge')
  }
  return path.join(env.XDG_RUNTIME_DIR, SOCKET_DIRECTORY, SOCKET_NAME)
}

async function removeStaleSocket(socketPath) {
  try {
    const stat = await fs.promises.lstat(socketPath)
    if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket path: ${socketPath}`)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  await assertSocketIsInactive(socketPath)
  await fs.promises.unlink(socketPath)
}

function assertSocketIsInactive(socketPath) {
  return new Promise((resolve, reject) => {
    const probe = net.createConnection(socketPath)
    probe.once('connect', () => {
      probe.destroy()
      reject(new Error(`Remote Bridge is already listening at ${socketPath}`))
    })
    probe.once('error', (error) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve()
      else reject(error)
    })
  })
}

async function removeSocketIfPresent(socketPath) {
  try {
    const stat = await fs.promises.lstat(socketPath)
    if (stat.isSocket()) await fs.promises.unlink(socketPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

module.exports = {
  RemoteBridge,
  SOCKET_DIRECTORY,
  SOCKET_NAME,
  closeServer,
  createAdapterState,
  listen,
  removeSocketIfPresent,
  removeStaleSocket,
  resolveSocketPath,
}
