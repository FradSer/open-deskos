const net = require('node:net')
const { randomUUID } = require('node:crypto')
const DEVICE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const emptyDeviceSnapshot = () => ({ status: 'disconnected', reason: 'bridge-unavailable', gateway: { status: 'disconnected' }, remote: { status: 'disconnected' }, peers: [], events: [] })
const path = require('node:path')
const { createRuntimeChannelProbe } = require('./runtime-channel-probe')

const REMOTE_LINK_STATES = new Set(['disconnected', 'usb', 'wireless', 'syncing'])
const REMOTE_NAVIGATION_DIRECTIONS = new Set(['previous', 'next'])
const REMOTE_INPUTS = new Set(['left', 'right', 'up', 'down', 'primary', 'secondary', 'back', 'mic', 'action'])
const DEFAULT_RECONNECT_DELAY_MS = 1000

function resolveRemoteBridgeSocketPath(env = process.env) {
  if (env.ODK_SHELL_TEST_MODE === '1' && env.ODK_REMOTE_BRIDGE_SOCKET) {
    if (!path.isAbsolute(env.ODK_REMOTE_BRIDGE_SOCKET)) {
      throw new Error('ODK_REMOTE_BRIDGE_SOCKET must be an absolute Unix socket path')
    }
    return env.ODK_REMOTE_BRIDGE_SOCKET
  }
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (!runtimeDir || !path.isAbsolute(runtimeDir)) return null
  return path.join(runtimeDir, 'odk-remote', 'bridge.sock')
}

function normalizePageState(state) {
  const pages = Number(state?.pages)
  const page = Number(state?.page)
  const name = typeof state?.name === 'string' ? state.name : ''
  if (!Number.isInteger(pages) || pages < 1 || !Number.isInteger(page) || page < 1 || page > pages || !name) {
    throw new Error('remote state requires a valid page, pages, and name')
  }
  return {
    v: 1,
    type: 'state',
    page,
    pages,
    name,
    canPrev: page > 1,
    canNext: page < pages,
    ...(state?.mode ? { mode: state.mode } : {}),
    ...(state?.surface ? { surface: state.surface } : {}),
    ...(state?.canFocus === true ? { canFocus: true } : {}),
    ...(Array.isArray(state?.actions) ? { actions: state.actions } : {}),
  }
}

function parseBridgeRecords(chunk, remainder, wasDiscarding = false) {
  const text = `${remainder}${chunk.toString('utf8')}`
  const lines = text.split('\n')
  let pending = lines.pop()
  let discarding = false
  if (wasDiscarding) { if (lines.length) lines.shift(); else { pending = ''; discarding = true } }
  const linkStates = []
  const navigations = []
  const inputs = []
  const deviceRecords = []
  if (Buffer.byteLength(pending) > 2048) { pending = ''; discarding = true }
  for (const line of lines) {
    if (!line || Buffer.byteLength(line) > 2048) continue
    try {
      const record = JSON.parse(line)
      if (record?.v === 1 && ['device_reply', 'device_snapshot', 'device_event'].includes(record.type)) {
        deviceRecords.push(record); continue
      }
      if (Buffer.byteLength(line) > 512) continue
      if (record?.v === 1 && record.type === 'link' && REMOTE_LINK_STATES.has(record.state)) {
        linkStates.push(record.state)
      } else if (record?.v === 1 && record.type === 'navigate' && REMOTE_NAVIGATION_DIRECTIONS.has(record.direction)) {
        navigations.push(record.direction)
      } else if (record?.v === 1 && record.type === 'input' && REMOTE_INPUTS.has(record.input)) {
        inputs.push(record.input === 'action' && (record.action || record.id) ? { input: 'action', action: record.action || record.id } : record.input)
      }
    } catch {
      // Invalid Bridge records never affect shell state.
    }
  }
  return { pending, discarding, linkStates, navigations, inputs, deviceRecords }
}

function createRemoteBridgeClient({
  socketPath,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  createConnection = net.createConnection,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onRemoteMic,
  diagnosisTimeoutMs = 500,
  deviceTimeoutMs = 2500,
  now = Date.now,
  deviceFreshnessMs = 3500,
} = {}) {
  let socket = null
  let reconnectTimer = null
  let running = false
  let currentLinkState = 'disconnected'
  let inboundRemainder = ''
  let inboundDiscarding = false
  let lastPageState = null
  let deviceSnapshot = emptyDeviceSnapshot()
  let deviceEnabled = false
  let deviceReceivedAt = 0, deviceFreshTimer = null
  const deviceSubscribers = new Set(), eventSubscribers = new Set(), devicePending = new Map()
  const linkSubscribers = new Set()
  const navigationSubscribers = new Set()
  const inputSubscribers = new Set()
  const diagnosis = createRuntimeChannelProbe({ endpoint: socketPath, host: 'remote-bridge', instance: 'bridge', connect: createConnection, timeoutMs: diagnosisTimeoutMs })

  function notifyDevices(snapshot) {
    if (deviceFreshTimer) clearTimeoutFn(deviceFreshTimer)
    deviceFreshTimer = null
    deviceSnapshot = structuredClone(snapshot)
    if (snapshot.status === 'live') { deviceReceivedAt = now(); deviceFreshTimer = setTimeoutFn(expireDevices, deviceFreshnessMs + 1); deviceFreshTimer?.unref?.() }
    for (const listener of deviceSubscribers) { try { listener(structuredClone(deviceSnapshot)) } catch {} }
  }
  function expireDevices() {
    deviceFreshTimer = null
    if (deviceSnapshot.status !== 'live') return
    if (now() - deviceReceivedAt > deviceFreshnessMs) notifyDevices(emptyDeviceSnapshot())
    else { deviceFreshTimer = setTimeoutFn(expireDevices, Math.max(1, deviceFreshnessMs - (now() - deviceReceivedAt) + 1)); deviceFreshTimer?.unref?.() }
  }
  function readDevices() {
    if (deviceSnapshot.status === 'live' && now() - deviceReceivedAt > deviceFreshnessMs) notifyDevices(emptyDeviceSnapshot())
    return structuredClone(deviceSnapshot)
  }
  function clearDevices() {
    for (const item of devicePending.values()) { clearTimeoutFn(item.timer); item.resolve({ ok: false, error: item.send ? 'delivery-unknown' : 'unavailable' }) }
    devicePending.clear(); notifyDevices(emptyDeviceSnapshot())
  }
  function onDeviceRecord(record) {
    if (record.type === 'device_snapshot' && validDeviceSnapshot(record.snapshot)) notifyDevices(record.snapshot)
    else if (record.type === 'device_event' && validDeviceEvent(record.event)) {
      for (const listener of eventSubscribers) { try { listener(structuredClone(record.event)) } catch {} }
    } else if (record.type === 'device_reply' && DEVICE_UUID.test(record.requestId) && record.result && typeof record.result.ok === 'boolean') {
      const item = devicePending.get(record.requestId)
      if (!item) return
      devicePending.delete(record.requestId); clearTimeoutFn(item.timer)
      if (record.result.snapshot && !validDeviceSnapshot(record.result.snapshot)) { item.resolve({ ok: false, error: 'invalid-reply' }); return }
      if (record.result.snapshot) notifyDevices(record.result.snapshot)
      item.resolve(record.result)
    }
  }
  function notifyLinkState(next) {
    if (!REMOTE_LINK_STATES.has(next) || currentLinkState === next) return
    currentLinkState = next
    for (const listener of linkSubscribers) listener(next)
  }

  function notifyNavigation(direction) {
    for (const listener of navigationSubscribers) listener(direction)
  }

  function notifyInput(input) {
    if (input === 'mic' && typeof onRemoteMic === 'function') {
      onRemoteMic()
      return
    }
    for (const listener of inputSubscribers) listener(input)
  }

  function writeState() {
    if (!socket || socket.destroyed || !lastPageState) return false
    socket.write(`${JSON.stringify(lastPageState)}\n`)
    return true
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) return
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null
      connect()
    }, reconnectDelayMs)
  }

  function connect() {
    if (!running || socket) return
    try {
      socket = createConnection(socketPath)
    } catch {
      notifyLinkState('disconnected')
      scheduleReconnect()
      return
    }
    const activeSocket = socket
    inboundRemainder = ''; inboundDiscarding = false
    activeSocket.once('connect', () => {
      if (socket !== activeSocket) return
      writeState()
      if (deviceEnabled) void api.deviceAction({ type: 'status' })
    })
    activeSocket.on('data', (chunk) => {
      if (socket !== activeSocket) return
      const parsed = parseBridgeRecords(chunk, inboundRemainder, inboundDiscarding)
      inboundRemainder = parsed.pending; inboundDiscarding = parsed.discarding
      for (const record of parsed.deviceRecords) onDeviceRecord(record)
      for (const state of parsed.linkStates) notifyLinkState(state)
      for (const direction of parsed.navigations) notifyNavigation(direction)
      for (const input of parsed.inputs) notifyInput(input)
    })
    activeSocket.on('error', () => {})
    activeSocket.once('close', () => {
      if (socket !== activeSocket) return
      socket = null
      clearDevices()
      notifyLinkState('disconnected')
      scheduleReconnect()
    })
  }

  const api = {
    start() {
      if (running || !socketPath) return
      running = true
      connect()
    },
    stop() {
      running = false
      diagnosis.stop()
      clearDevices()
      if (reconnectTimer) clearTimeoutFn(reconnectTimer)
      reconnectTimer = null
      const activeSocket = socket
      socket = null
      activeSocket?.destroy()
      notifyLinkState('disconnected')
    },
    getDeviceSnapshot() { return readDevices() },
    onDeviceSnapshot(listener) { if (!deviceEnabled) { deviceEnabled = true; void api.deviceAction({ type: 'status' }) } deviceSubscribers.add(listener); listener(readDevices()); return () => deviceSubscribers.delete(listener) },
    onDeviceEvent(listener) { if (!deviceEnabled) { deviceEnabled = true; void api.deviceAction({ type: 'status' }) } eventSubscribers.add(listener); return () => eventSubscribers.delete(listener) },
    deviceAction(action) {
      if (!running || !socket || socket.destroyed || socket.connecting) return Promise.resolve({ ok: false, error: 'unavailable' })
      if (!validDeviceAction(action)) return Promise.resolve({ ok: false, error: 'invalid-action' })
      if (devicePending.size >= 8) return Promise.resolve({ ok: false, error: 'busy' })
      const requestId = randomUUID(), activeSocket = socket
      const line = JSON.stringify({ v: 1, type: 'device_request', requestId, action }) + '\n'
      if (Buffer.byteLength(line) > 2048 || (socket.writableLength || 0) + Buffer.byteLength(line) > 65536) return Promise.resolve({ ok: false, error: 'busy' })
      return new Promise(resolve => {
        const finish = result => { const item = devicePending.get(requestId); if (!item) return; devicePending.delete(requestId); clearTimeoutFn(item.timer); resolve(result) }
        const timer = setTimeoutFn(() => finish({ ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'deadline' }), deviceTimeoutMs)
        devicePending.set(requestId, { resolve, timer, send: action.type === 'send' })
        try { activeSocket.write(line, error => { if (error) finish({ ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'unavailable' }) }) }
        catch { finish({ ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'unavailable' }) }
      })
    },
    publishPageState(state) {
      lastPageState = normalizePageState(state)
      return writeState()
    },
    diagnose(options) {
      return running ? diagnosis.request(options) : Promise.resolve([{ host: 'remote-bridge', instance: 'bridge', state: 'unavailable', reason: 'disconnected', plugins: [] }])
    },
    getLinkState() {
      return currentLinkState
    },
    onLinkState(listener) {
      linkSubscribers.add(listener)
      listener(currentLinkState)
      return () => linkSubscribers.delete(listener)
    },
    onNavigation(listener) {
      navigationSubscribers.add(listener)
      return () => navigationSubscribers.delete(listener)
    },
    onInput(listener) {
      inputSubscribers.add(listener)
      return () => inputSubscribers.delete(listener)
    },
  }
  return api
}

function validDeviceAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false
  if (['status', 'ping'].includes(action.type)) return Object.keys(action).length === 1
  return action.type === 'send' && Object.keys(action).length === 3 && typeof action.peer === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(action.peer)
    && typeof action.payload === 'string' && action.payload.length > 0 && action.payload.length <= 336 && Buffer.from(action.payload, 'base64').length <= 250 && Buffer.from(action.payload, 'base64').toString('base64') === action.payload
}
function validDeviceEvent(event) { return event && typeof event.peer === 'string' && validDeviceAction({ type: 'send', peer: event.peer, payload: event.payload }) && Number.isFinite(event.receivedAt) }
function validDeviceSnapshot(snapshot) { return snapshot && ['live', 'disconnected'].includes(snapshot.status) && snapshot.gateway && snapshot.remote && ['disconnected', 'syncing', 'ready'].includes(snapshot.remote.status)
  && Array.isArray(snapshot.peers) && snapshot.peers.length <= 7 && Array.isArray(snapshot.events) && snapshot.events.length <= 2 && snapshot.events.every(validDeviceEvent) }
module.exports = {
  REMOTE_LINK_STATES,
  REMOTE_NAVIGATION_DIRECTIONS,
  REMOTE_INPUTS,
  createRemoteBridgeClient,
  resolveRemoteBridgeSocketPath,
}
