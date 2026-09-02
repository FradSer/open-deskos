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
  constructor({ transports = [], socketPath = resolveSocketPath(), logger = console } = {}) {
    this.transports = [...transports].sort((a, b) => (b.priority || 0) - (a.priority || 0))
    this.socketPath = socketPath
    this.logger = logger
    this.server = null
    this.clients = new Set()
    this.latestShellState = null
    this.linkState = createLinkState('disconnected')
    this.activeTransport = null
    this.started = false

    for (const transport of this.transports) {
      transport.on('connected', (details) => {
        void this.#onTransportConnected(transport, details)
      })
      transport.on('disconnected', (details) => {
        this.#onTransportDisconnected(transport, details)
      })
      transport.on('message', (record) => this.#onTransportMessage(record))
      transport.on('adapter-error', (error) => this.logger.error('Remote Link transport error', error))
    }
  }

  async start() {
    if (this.started) return
    await fs.promises.mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 })
    await removeStaleSocket(this.socketPath)
    this.server = net.createServer((socket) => this.#attachClient(socket))
    await listen(this.server, this.socketPath)
    await fs.promises.chmod(this.socketPath, 0o600)
    this.started = true

    for (const transport of this.transports) {
      try {
        if (typeof transport.init === 'function') await transport.init()
        await transport.start()
      } catch (error) {
        this.logger.error(`Failed to start transport ${transport.manifest?.id || 'unknown'}`, error)
      }
    }
  }

  async stop() {
    if (!this.server && !this.started) return
    this.started = false
    for (const client of this.clients) client.destroy()
    this.clients.clear()

    for (const transport of this.transports) {
      try {
        await transport.stop()
        if (typeof transport.destroy === 'function') await transport.destroy()
      } catch (error) {
        this.logger.error(`Error stopping transport ${transport.manifest?.id || 'unknown'}`, error)
      }
    }

    if (this.server) {
      const s = this.server
      this.server = null
      await closeServer(s)
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

  async #onTransportConnected(transport, { transport: transportKind }) {
    if (!this.started) return
    // Check if higher priority than current active
    if (!this.activeTransport || (transport.priority || 0) >= (this.activeTransport.priority || 0)) {
      this.activeTransport = transport
      this.activeTransportKind = transportKind
      this.#publishLinkState('syncing')
      await this.#synchronizeActiveLink()
    }
  }

  #onTransportDisconnected(transport, _details) {
    if (!this.started) return
    if (this.activeTransport === transport) {
      this.activeTransport = null
      this.activeTransportKind = null
      // Find fallback connected transport with highest priority
      const fallback = this.transports.find((t) => t !== transport && t.isConnected)
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
    const validation = validateNavigate(record)
    if (!validation.ok) return
    this.#broadcast(record)
  }

  async #synchronizeActiveLink() {
    if (!this.activeTransport || !this.latestShellState) return
    try {
      await this.activeTransport.send(createAdapterState(this.latestShellState, this.activeTransportKind))
    } catch (error) {
      this.logger.error('Remote Link state synchronization failed', error)
      return
    }
    if (this.activeTransport) this.#publishLinkState(linkStateForTransport(this.activeTransportKind))
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
