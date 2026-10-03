const net = require('node:net')
const { readOrCreateToken, requiresToken, writeHandshake } = require('./local-channel')
const { resolveShellHost } = require('./platform')

const STATES = new Set(['idle', 'recording', 'transcribing', 'thinking', 'error'])
const MAX_STATUS_BYTES = 131072
const MAX_MESSAGE_CHARACTERS = 16384
const MAX_TRANSCRIPT_CHARACTERS = 4096

/**
 * The voice link is a runtime channel, so its endpoint comes from the host's own
 * naming: a socket in the runtime directory on a Unix host, and the `personal-bot`
 * named pipe on a Windows host. A Unix host with no runtime directory still
 * resolves nothing rather than guessing where a service would listen.
 */
function resolvePersonalBotSocketPath(env = process.env, host = null) {
  const resolved = host || resolveShellHost({ env })
  return resolved.endpoint('personal-bot')
}

function createPersonalBotClient({ socketPath, env = process.env, platform = process.platform, host = null, token = '', reconnectDelayMs = 1000 } = {}) {
  const resolvedHost = host || resolveShellHost({ env, platform })
  // A named pipe carries no owner, so the channel token is what authenticates the
  // peer there. A Unix socket is already gated by ownership, and a client written
  // before the token existed keeps reaching the protocol with every byte it sent.
  const needsToken = Boolean(socketPath) && requiresToken({ endpoint: socketPath, platform })
  let tokenPromise = null
  let socket = null
  let connected = false
  let running = false
  let timer = null
  let status = { state: 'unavailable', message: 'Personal Bot service unavailable' }
  const listeners = new Set()

  // The token is read when the endpoint needs one, not when the client is
  // created, because the Shell builds its client before anything is listening.
  async function channelToken() {
    if (token) return token
    if (!needsToken) return ''
    if (!tokenPromise) tokenPromise = readOrCreateToken({ stateDir: resolvedHost.stateDir })
    return tokenPromise
  }

  function publish(next) {
    status = next
    for (const listener of listeners) listener({ ...status })
  }

  function write(type, payload = {}) {
    if (!connected || !socket || socket.destroyed) return false
    socket.write(`${JSON.stringify({ v: 1, type, ...payload })}\n`)
    return true
  }

  function connect() {
    if (!running) return
    const active = net.createConnection(socketPath)
    socket = active
    let remainder = ''
    active.setEncoding('utf8')
    active.once('connect', () => {
      connected = true
      channelToken().then((value) => {
        // A connection that lost its socket while the token was being read must
        // not write into it, and an unreadable token is not a reason to present
        // an unauthenticated connection: the service drops those anyway.
        if (socket !== active || !connected || active.destroyed) return
        if (value) writeHandshake(active, value)
        write('status')
      }, () => active.destroy())
    })
    active.on('data', (chunk) => {
      remainder += chunk
      const lines = remainder.split('\n')
      remainder = lines.pop()
      if (Buffer.byteLength(remainder) > MAX_STATUS_BYTES) return active.destroy()
      for (const line of lines) {
        if (Buffer.byteLength(line) > MAX_STATUS_BYTES) return active.destroy()
        let record
        try { record = JSON.parse(line) } catch { continue }
        if (record?.v !== 1 || record.type !== 'status' || !STATES.has(record.state)) continue
        const level = record.state === 'recording' && Number.isFinite(record.level)
          && record.level >= 0 && record.level <= 1 ? record.level : 0
        const transcript = ['thinking', 'idle', 'error'].includes(record.state) && typeof record.transcript === 'string'
          ? record.transcript.slice(0, MAX_TRANSCRIPT_CHARACTERS) : ''
        publish({
          state: record.state,
          message: typeof record.message === 'string' ? record.message.slice(0, MAX_MESSAGE_CHARACTERS) : '',
          transcript,
          level,
          ...(Array.isArray(record.proposals) && record.proposals.length <= 64 ? { proposals: record.proposals, proposalPopup: record.proposalPopup === true, proposalInteraction: record.proposalInteraction === true, proposalHiddenCount: Number.isSafeInteger(record.proposalHiddenCount) ? record.proposalHiddenCount : 0 } : {}),
          ...(typeof record.proposalError === 'string' ? { proposalError: record.proposalError.slice(0, 256) } : {}),
        })
      }
    })
    active.on('error', () => {})
    active.once('close', () => {
      if (socket !== active) return
      connected = false
      socket = null
      publish({ state: 'unavailable', message: 'Personal Bot service unavailable' })
      if (running) timer = setTimeout(connect, reconnectDelayMs)
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
      clearTimeout(timer)
      connected = false
      const active = socket
      socket = null
      active?.destroy()
    },
    toggle: () => write('toggle'),
    servicePush: (readingIds) => Array.isArray(readingIds) && readingIds.length > 0 && readingIds.length <= 32 && readingIds.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) && write('proactive_event', { readingIds }),
    proposalCommand: ({ type, ...payload }) => ['proposal_respond', 'proposal_list', 'proposal_presented'].includes(type) && write(type, payload),
    snapshot: () => ({ ...status }),
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...status })
      return () => listeners.delete(listener)
    },
  }
}

module.exports = { createPersonalBotClient, resolvePersonalBotSocketPath }
