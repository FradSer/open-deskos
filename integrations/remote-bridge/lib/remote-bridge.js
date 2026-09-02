'use strict'

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { createJsonLineReader } = require('./json-line-reader')
const {
  createLinkState,
  encodeJsonLine,
  parseJsonLine,
  validateNavigate,
  validateShellState,
} = require('./protocol')

const SOCKET_DIRECTORY = 'open-deskos-remote'
const SOCKET_NAME = 'bridge.sock'

class RemoteBridge {
  constructor({ adapter, socketPath = resolveSocketPath(), logger = console } = {}) {
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
    this.adapter.on('connected', (details) => {
      void this.#onAdapterConnected(details)
    })
    this.adapter.on('disconnected', (details) => {
      this.#onAdapterDisconnected(details)
    })
    this.adapter.on('message', (record) => this.#onAdapterMessage(record))
    this.adapter.on('adapter-error', (error) => this.logger.error('Remote Link adapter error', error))
  }

  async start() {
    if (this.started) return
    await fs.promises.mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 })
    await removeStaleSocket(this.socketPath)
    this.server = net.createServer((socket) => this.#attachClient(socket))
    await listen(this.server, this.socketPath)
    await fs.promises.chmod(this.socketPath, 0o600)
    this.started = true
    try {
      await this.adapter.start()
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop() {
    if (!this.server && !this.started) return
    this.started = false
    for (const client of this.clients) client.destroy()
    this.clients.clear()
    await this.adapter.stop()
    if (this.server) {
      await closeServer(this.server)
      this.server = null
    }
    await removeSocketIfPresent(this.socketPath)
  }

  #attachClient(socket) {
    this.clients.add(socket)
    socket.write(encodeJsonLine(this.linkState))
    const reader = createJsonLineReader((line) => this.#onClientLine(line))
    socket.on('data', (chunk) => reader.push(chunk))
    socket.once('end', () => reader.end())
    socket.once('close', () => this.clients.delete(socket))
    socket.once('error', () => this.clients.delete(socket))
  }

  async #onClientLine(line) {
    const parsed = parseJsonLine(line)
    if (!parsed.ok) return
    const validation = validateShellState(parsed.record)
    if (!validation.ok) return
    this.latestShellState = parsed.record
    if (this.activeTransport) await this.#synchronizeActiveLink()
  }

  async #onAdapterConnected({ transport }) {
    if (!this.started) return
    this.activeTransport = transport
    this.#publishLinkState('syncing')
    await this.#synchronizeActiveLink()
  }

  #onAdapterDisconnected({ transport, reason } = {}) {
    if (!this.started) return
    if (transport && transport !== this.activeTransport) return
    this.activeTransport = null
    this.#publishLinkState('disconnected')
  }

  #onAdapterMessage(record) {
    const validation = validateNavigate(record)
    if (!validation.ok) return
    this.#broadcast(record)
  }

  async #synchronizeActiveLink() {
    if (!this.activeTransport || !this.latestShellState) return
    try {
      await this.adapter.send(createAdapterState(this.latestShellState, this.activeTransport))
    } catch (error) {
      this.logger.error('Remote Link state synchronization failed', error)
      return
    }
    if (this.activeTransport) this.#publishLinkState(linkStateForTransport(this.activeTransport))
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
