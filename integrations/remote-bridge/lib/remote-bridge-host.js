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
const {
  SOCKET_DIRECTORY,
  SOCKET_NAME,
  closeServer,
  createAdapterState,
  listen,
  removeSocketIfPresent,
  removeStaleSocket,
  resolveSocketPath,
} = require('./remote-bridge')

class RemoteBridgeHost {
  constructor({ transports = [], socketPath = resolveSocketPath(), logger = console, replacementPlugins = [], disabled = [] } = {}) {
    this.transports = [...transports].sort((a, b) => (b.priority || 0) - (a.priority || 0))
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
      transports: this.transports,
      replacementPlugins,
      disabled,
      onTransportCreated: (previous, actual) => {
        const index = this.transports.indexOf(previous)
        this.transports[index] = actual
      },
      logger,
      initialize: true,
      open: (signal) => this.#open(signal),
      close: () => this.#close(),
      handlers: {
        connected: (transport, details) => this.#onTransportConnected(transport, details),
        disconnected: (transport, details) => this.#onTransportDisconnected(transport, details),
        message: (_transport, record) => this.#onTransportMessage(record),
        'adapter-error': (_transport, error) => this.logger.error('Remote Link adapter error', error),
      },
      withdrawn: (transport) => this.#onTransportDisconnected(transport),
    })
  }

  async start() {
    const epoch = this.generation
    const catalog = await this.runtime.host.start()
    if (epoch !== this.generation) return
    const failed = catalog.find(entry => entry.manifest.id === this.runtime.listenerId && entry.state !== 'running')

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
    this.activeTransportKind = null
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
    this.latestShellState = parsed.record
    if (this.activeTransport) await this.#synchronizeActiveLink()
  }

  async #onTransportConnected(transport, { transport: transportKind }) {
    if (!this.started) return
    // Check if higher priority than current active
    if (!this.activeTransport || (transport.priority || 0) >= (this.activeTransport.priority || 0)) {
      this.linkRevision++
      this.activeTransport = transport
      this.activeTransportKind = transportKind
      this.#publishLinkState('syncing')
      await this.#synchronizeActiveLink()
    }
  }

  #onTransportDisconnected(transport, _details) {
    if (!this.started) return
    if (this.activeTransport === transport) {
      this.linkRevision++
      this.activeTransport = null
      this.activeTransportKind = null
      // Find fallback connected transport with highest priority
      const fallback = this.transports.find((t) => t !== transport && t.isConnected && this.runtime.isAvailable(t))
      if (fallback) {
        this.activeTransport = fallback
        this.activeTransportKind = fallback.transport
        this.#publishLinkState(linkStateForTransport(fallback.transport))
        void this.#synchronizeActiveLink()
      } else {
        this.#publishLinkState('disconnected')
      }
    }
  }

  #onTransportMessage(record) {
    if (!validateNavigate(record).ok && !validateRemoteInput(record).ok) return
    this.#broadcast(record)
  }

  async #synchronizeActiveLink() {
    if (!this.activeTransport || !this.latestShellState) return
    const revision = this.linkRevision
    const epoch = this.generation
    try {
      await this.activeTransport.send(createAdapterState(this.latestShellState, this.activeTransportKind))
    } catch (error) {
      this.logger.error('Remote Link state synchronization failed', error)
      return
    }
    if (this.started && epoch === this.generation && revision === this.linkRevision && this.activeTransport && this.runtime.isAvailable(this.activeTransport)) this.#publishLinkState(linkStateForTransport(this.activeTransportKind))
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

function linkStateForTransport(transportKind) {
  return transportKind === 'usb-cdc' ? 'usb' : 'wireless'
}

module.exports = {
  RemoteBridgeHost,
}
