const net = require('node:net')
const path = require('node:path')

const REMOTE_LINK_STATES = new Set(['disconnected', 'usb', 'wireless', 'syncing'])
const REMOTE_NAVIGATION_DIRECTIONS = new Set(['previous', 'next'])
const DEFAULT_RECONNECT_DELAY_MS = 1000

function resolveRemoteBridgeSocketPath(env = process.env) {
  if (env.ODESK_SHELL_TEST_MODE === '1' && env.ODESK_REMOTE_BRIDGE_SOCKET) {
    if (!path.isAbsolute(env.ODESK_REMOTE_BRIDGE_SOCKET)) {
      throw new Error('ODESK_REMOTE_BRIDGE_SOCKET must be an absolute Unix socket path')
    }
    return env.ODESK_REMOTE_BRIDGE_SOCKET
  }
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (!runtimeDir || !path.isAbsolute(runtimeDir)) return null
  return path.join(runtimeDir, 'open-deskos-remote', 'bridge.sock')
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
  }
}

function parseBridgeRecords(chunk, remainder) {
  const text = `${remainder}${chunk.toString('utf8')}`
  const lines = text.split('\n')
  const pending = lines.pop()
  const linkStates = []
  const navigations = []
  if (pending.length > 512) return { pending: '', linkStates, navigations }
  for (const line of lines) {
    if (!line || line.length > 512) continue
    try {
      const record = JSON.parse(line)
      if (record?.v === 1 && record.type === 'link' && REMOTE_LINK_STATES.has(record.state)) {
        linkStates.push(record.state)
      } else if (record?.v === 1 && record.type === 'navigate' && REMOTE_NAVIGATION_DIRECTIONS.has(record.direction)) {
        navigations.push(record.direction)
      }
    } catch {
      // Invalid Bridge records never affect shell state.
    }
  }
  return { pending, linkStates, navigations }
}

function createRemoteBridgeClient({
  socketPath,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
  createConnection = net.createConnection,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let socket = null
  let reconnectTimer = null
  let running = false
  let currentLinkState = 'disconnected'
  let inboundRemainder = ''
  let lastPageState = null
  const linkSubscribers = new Set()
  const navigationSubscribers = new Set()

  function notifyLinkState(next) {
    if (!REMOTE_LINK_STATES.has(next) || currentLinkState === next) return
    currentLinkState = next
    for (const listener of linkSubscribers) listener(next)
  }

  function notifyNavigation(direction) {
    for (const listener of navigationSubscribers) listener(direction)
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
    inboundRemainder = ''
    activeSocket.once('connect', () => {
      if (socket !== activeSocket) return
      writeState()
    })
    activeSocket.on('data', (chunk) => {
      if (socket !== activeSocket) return
      const parsed = parseBridgeRecords(chunk, inboundRemainder)
      inboundRemainder = parsed.pending
      for (const state of parsed.linkStates) notifyLinkState(state)
      for (const direction of parsed.navigations) notifyNavigation(direction)
    })
    activeSocket.on('error', () => {})
    activeSocket.once('close', () => {
      if (socket !== activeSocket) return
      socket = null
      notifyLinkState('disconnected')
      scheduleReconnect()
    })
  }

  return {
    start() {
      if (running || !socketPath) return
      running = true
      connect()
    },
    stop() {
      running = false
      if (reconnectTimer) clearTimeoutFn(reconnectTimer)
      reconnectTimer = null
      const activeSocket = socket
      socket = null
      activeSocket?.destroy()
      notifyLinkState('disconnected')
    },
    publishPageState(state) {
      lastPageState = normalizePageState(state)
      return writeState()
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
  }
}

module.exports = {
  REMOTE_LINK_STATES,
  REMOTE_NAVIGATION_DIRECTIONS,
  createRemoteBridgeClient,
  resolveRemoteBridgeSocketPath,
}
