'use strict'
const { randomBytes } = require('node:crypto')
const { TextDecoder } = require('node:util')
const { RemoteLinkAdapter } = require('./remote-link-adapter')
const { loadShellModule } = require('./plugin-runtime')
const { validateRemoteInput } = require('./protocol')
const { TYPES, frames, decode, statePayload } = require('./esp-now-protocol')
const radioDeclaration = { manifest: { id: 'odk.remote.transport.esp-now', name: 'Paired ESP-NOW Remote', version: '1.0.0' }, priority: 50, transport: 'wireless' }

class EspNowAdapter extends RemoteLinkAdapter {
  constructor({ configFile, config, sourceFactory, now = Date.now, intervalMs = 1000, deadlineMs = 2000 } = {}) {
    super()
    Object.assign(this, radioDeclaration)
    const gateway = loadShellModule('device-gateway-source.js')
    this.config = config ? gateway.validateConfig(config) : gateway.loadConfig(configFile)
    if (!this.config || !this.config.peers.length || (!this.config.remoteMac && this.config.peers.length !== 1) || !this.config.pmk) throw Error('ESP-NOW Remote requires one reserved encrypted peer; multiple peers require remoteMac')
    this.peer = (this.config.remoteMac || this.config.peers[0].mac).toLowerCase()
    this.gatewayState = { status: 'disconnected', reason: 'not-started' }; this.deviceEvents = []; this.peerSeen = new Map(); this.deviceQueued = 0
    this.sourceFactory = sourceFactory || gateway.createDeviceGatewaySource
    this.now = now; this.intervalMs = intervalMs; this.deadlineMs = deadlineMs
    this.host = randomBytes(4).readUInt32LE() || 1
    this.running = false; this.isConnected = false; this.remote = 0; this.sequence = 0; this.lastInput = 0
    this.epoch = 0; this.stateQueued = 0; this.stateTx = Promise.resolve(); this.lastSeen = 0; this.syncedActions = null; this.pending = new Map(); this.queued = 0; this.tx = Promise.resolve()
  }
  async start() {
    if (this.running) return
    if (this.source) throw Error('gateway cleanup required')
    this.running = true
    this.source = this.sourceFactory({ config: this.config, onReceive: record => this.receive(record) })
    const source = this.source
    const tick = async () => {
      if (this.ticking || !this.running) return
      this.ticking = true
      try {
        const state = await source.refresh()
        if (this.running && source === this.source) { this.gatewayState = state; this.gatewayObservedAt = this.now(); if (state.status !== 'live') { this.deviceEvents = []; this.peerSeen.clear() } this.publishDevices() }
        if (this.running && source === this.source && (state.status !== 'live' || (this.isConnected && this.now() - this.lastSeen > 3500))) this.disconnect()
      } catch { if (this.running && source === this.source) { this.gatewayState = { status: 'unavailable', reason: 'device-unavailable' }; this.deviceEvents = []; this.peerSeen.clear(); this.disconnect(); this.publishDevices() } }
      finally { this.ticking = false }
    }
    this.timer = setInterval(() => { void tick() }, this.intervalMs)
    await tick()
  }
  disconnect() {
    this.epoch++
    const connected = this.isConnected
    this.isConnected = false; this.syncedActions = null
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('radio-disconnected')) }
    this.pending.clear()
    if (connected) this.emit('disconnected', { transport: this.transport })
    this.publishDevices()
  }
  transmit(frame) {
    if (!this.running || this.queued >= 8) return Promise.reject(Error('radio-unavailable'))
    this.queued++
    const source = this.source
    const epoch = this.epoch
    const result = this.tx.then(async () => {
      if (!this.running || source !== this.source || epoch !== this.epoch) throw Error('radio-stopped')
      const reply = await source.action({ type: 'send', peer: this.peer, payload: frame.toString('base64') })
      if (!reply.ok) throw Error('radio-delivery-unknown')
    }).finally(() => { this.queued-- })
    this.tx = result.catch(() => {})
    return result
  }
  receive(record) {
    if (!this.running || this.deviceSnapshot().status !== 'live' || typeof record?.peer !== 'string' || typeof record.payload !== 'string') return
    const peer = record.peer.toLowerCase()
    if (peer !== this.peer) {
      if (!this.config.peers.some(item => item.mac.toLowerCase() === peer) || !validPayload(record.payload) || Buffer.from(record.payload, 'base64').subarray(0, 4).toString() === 'ODKR') return
      const event = { peer, payload: record.payload, receivedAt: this.now() }
      this.peerSeen.set(peer, event.receivedAt); this.deviceEvents = [...this.deviceEvents.slice(-1), event]
      this.emit('device-event', event); this.publishDevices(); return
    }
    const frame = decode(Buffer.from(record.payload, 'base64'))
    if (!frame) return
    if (frame.type === TYPES.HELLO) {
      // A new boot must complete the host challenge before any input is admitted.
      if (frame.remote !== this.remote) {
        this.disconnect(); this.remote = frame.remote; this.lastInput = 0
      }
      if (frame.host === this.host) {
        this.lastSeen = this.now(); this.publishDevices()
        if (!this.isConnected) { this.isConnected = true; this.publishDevices(); this.emit('connected', { transport: this.transport }) }
      }
      void this.transmit(frames(TYPES.HELLO_ACK, frame.remote, this.host, 0)[0]).catch(() => {})
      return
    }
    if (!this.isConnected || this.now() - this.lastSeen > 3500 || frame.remote !== this.remote || frame.host !== this.host) return
    if (frame.type === TYPES.STATE_ACK) {
      const pending = this.pending.get(frame.sequence)
      if (pending) { this.pending.delete(frame.sequence); clearTimeout(pending.timer); this.syncedActions = pending.actions; this.publishDevices(); pending.resolve() }
    } else if (frame.type === TYPES.INPUT && this.syncedActions && frame.sequence > this.lastInput && frame.payload.length <= 96) {
      try {
        const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame.payload))
        if (!validateRemoteInput(input).ok || Object.keys(input).some(key => !['v', 'type', 'input', 'action'].includes(key)) || input.type !== 'input') return
        if (input.input === 'action' && !this.syncedActions.has(input.action)) return
        this.lastInput = frame.sequence
        this.emit('message', input)
      } catch {}
    }
  }
  send(record) {
    if (!this.running || this.stateQueued >= 4) return Promise.reject(Error('radio-not-ready'))
    let payload
    try { payload = statePayload(record) } catch (error) { return Promise.reject(error) }
    this.stateQueued++
    const epoch = this.epoch
    const result = this.stateTx.then(() => {
      if (epoch !== this.epoch) throw Error('radio-session-retired')
      return this.sendState(payload)
    }).finally(() => { this.stateQueued-- })
    this.stateTx = result.catch(() => {})
    return result
  }
  async sendState(payload) {
    if (!this.running || !this.isConnected || this.now() - this.lastSeen > 3500 || this.pending.size) throw Error('radio-not-ready')
    const sequence = ++this.sequence
    if (sequence > 0xffffffff) { this.disconnect(); throw Error('radio-sequence-exhausted') }
    const remote = this.remote
    this.syncedActions = null
    this.publishDevices()
    let resolve, reject
    const ack = new Promise((yes, no) => { resolve = yes; reject = no })
    // Observe early rejection while a serial write is pending.
    void ack.catch(() => {})
    const timer = setTimeout(() => {
      this.pending.delete(sequence); reject(Error('remote-state-ack-timeout'))
      this.disconnect()
    }, this.deadlineMs)
    this.pending.set(sequence, { resolve, reject, timer, actions: new Set(JSON.parse(payload).actions.map(a => a.id)) })
    try {
      for (const frame of frames(TYPES.STATE, remote, this.host, sequence, payload)) {
        if (!this.isConnected || this.remote !== remote || !this.pending.has(sequence)) throw Error('radio-session-retired')
        await this.transmit(frame)
      }
      await ack
    } catch (error) {
      clearTimeout(timer); this.pending.delete(sequence); reject(error); this.disconnect(); throw error
    }
  }
  deviceSnapshot() {
    const live = this.running && this.gatewayState.status === 'live' && this.now() - this.gatewayObservedAt <= 3500
    const recent = this.isConnected && this.now() - this.lastSeen <= 3500 && live
    const remoteStatus = recent ? (this.syncedActions ? 'ready' : 'syncing') : 'disconnected'
    const state = this.gatewayState
    return { status: live ? 'live' : 'disconnected', reason: live ? '' : 'bridge-unavailable',
      gateway: { serialNumber: this.config.serialNumber, status: live ? 'live' : 'disconnected',
        ...(live ? { mac: state.mac, firmware: state.firmware, channel: state.channel, receivedAt: state.receivedAt } : {}) },
      remote: { mac: this.peer, status: remoteStatus, ...(recent ? { lastSeen: this.lastSeen } : {}) },
      peers: this.config.peers.map(item => { const mac = item.mac.toLowerCase(), lastSeen = mac === this.peer ? (recent ? this.lastSeen : 0) : this.peerSeen.get(mac)
        return { mac, role: mac === this.peer ? 'remote' : 'device', status: lastSeen && live && this.now() - lastSeen <= 3500 ? 'live' : live && !lastSeen ? 'paired' : 'stale', ...(lastSeen && live ? { lastSeen } : {}) }
      }), events: live ? this.deviceEvents.map(event => ({ ...event })) : [] }
  }
  publishDevices() { this.emit('device-snapshot', this.deviceSnapshot()) }
  async deviceAction(action) {
    const gateway = loadShellModule('device-gateway-source.js')
    if (!gateway.validateAction(action)) return { ok: false, error: 'invalid-action' }
    if (!this.running || this.deviceSnapshot().status !== 'live' || !this.source) return { ok: false, error: 'unavailable' }
    if (action.type === 'send') {
      if (action.peer.toLowerCase() === this.peer) return { ok: false, error: 'reserved-peer' }
      if (!this.config.peers.some(peer => peer.mac.toLowerCase() === action.peer.toLowerCase())) return { ok: false, error: 'peer-not-granted' }
      if (Buffer.from(action.payload, 'base64').subarray(0, 4).toString() === 'ODKR') return { ok: false, error: 'reserved-protocol' }
    }
    if (this.deviceQueued >= 4) return { ok: false, error: 'busy' }
    const source = this.source, epoch = this.epoch
    this.deviceQueued++
    try {
      const reply = await source.action(action)
      if (!this.running || source !== this.source || epoch !== this.epoch) return { ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'unavailable' }
      return reply.ok ? { ok: true, delivery: action.type === 'send' ? 'mac-receipt' : 'usb-reply' } : { ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'unavailable' }
    } catch { return { ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'unavailable' } }
    finally { this.deviceQueued-- }
  }
  async stop() {
    this.running = false; this.deviceEvents = []; this.peerSeen.clear(); this.gatewayState = { status: 'disconnected' }; clearInterval(this.timer); this.disconnect()
    const source = this.source
    if (source) {
      await source.stop()
      await this.tx
      await this.stateTx
      this.source = null
    }
  }
}
function validPayload(value) { return typeof value === 'string' && value.length > 0 && value.length <= 336 && Buffer.from(value, 'base64').length <= 250 && Buffer.from(value, 'base64').toString('base64') === value }
module.exports = { EspNowAdapter, radioDeclaration }
