const net = require('node:net')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')
const { isNamedPipe, readOrCreateToken, requiresToken, writeHandshake } = require('./local-channel')
const { resolveShellHost } = require('./platform')

const DESK_LINK_PROTOCOL = 1
// Runtime snapshots include workspace membership as well as the session list.
// Keep their cap separate from a reporter's 64 KiB inbound message budget.
const MAX_RUNTIME_RESPONSE_BYTES = 2 * 1024 * 1024

function resolveDeskLinkSocketPath(env = process.env, host = null) {
  if (env.ODESK_SHELL_TEST_MODE === '1' && env.ODESK_DESK_LINK_SOCKET) {
    if (!path.isAbsolute(env.ODESK_DESK_LINK_SOCKET) && !isNamedPipe(env.ODESK_DESK_LINK_SOCKET)) {
      throw new Error('ODESK_DESK_LINK_SOCKET must be an absolute Unix socket path or a named pipe')
    }
    return env.ODESK_DESK_LINK_SOCKET
  }
  // A Windows host has no runtime directory to lay a socket out in, so the
  // endpoint comes from the platform's own naming: a named pipe either way.
  const resolved = host || resolveShellHost({ env })
  return resolved.endpoint('desk-link')
}

/**
 * One request per connection: a snapshot is always read fresh, never a push
 * that could age past its own scan time.
 */
function request(socketPath, record, timeoutMs = 2000, channel = {}) {
  return new Promise((resolve) => {
    let settled = false
    let remainder = ''
    let receivedBytes = 0
    const decoder = new StringDecoder('utf8')
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    const socket = net.createConnection(socketPath)
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => {
      // The token is only carried where the endpoint cannot be authenticated by
      // ownership, which keeps every Unix client that predates it byte-compatible.
      const endpoint = channel.endpoint ?? socketPath
      if (channel.token && requiresToken({ endpoint, platform: channel.platform })) writeHandshake(socket, channel.token)
      socket.write(`${JSON.stringify(record)}\n`)
    })
    socket.on('data', (chunk) => {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_RUNTIME_RESPONSE_BYTES) return finish(null)
      const text = `${remainder}${decoder.write(chunk)}`
      const newline = text.indexOf('\n')
      if (newline === -1) {
        remainder = text
        return
      }
      try {
        finish(JSON.parse(text.slice(0, newline).replace(/\r$/, '')))
      } catch {
        finish(null)
      }
    })
    socket.on('timeout', () => finish(null))
    socket.on('error', () => finish(null))
    socket.on('close', () => finish(null))
  })
}

function createDeskLinkClient({ socketPath, env = process.env, send = request, token = '', platform = process.platform, host = null } = {}) {
  const resolvedHost = host || resolveShellHost({ env, platform })
  const resolved = socketPath ?? resolveDeskLinkSocketPath(env, resolvedHost)
  const needsToken = Boolean(resolved) && requiresToken({ endpoint: resolved, platform })
  const unavailable = (reason) => ({ ok: false, reason, scannedAt: null, summary: null, sessions: [], workspaces: [] })

  // The token is read when the endpoint needs one, not when the client is
  // created, because the Shell builds its client before anything is listening.
  let tokenPromise = null
  async function channelToken() {
    if (token) return token
    if (!needsToken) return ''
    if (!tokenPromise) tokenPromise = readOrCreateToken({ stateDir: resolvedHost.stateDir })
    return tokenPromise
  }

  async function ask(record) {
    return send(resolved, record, undefined, { endpoint: resolved, platform, token: await channelToken() })
  }

  return {
    socketPath: resolved,
    async snapshot() {
      if (!resolved) return unavailable('desk-link-unconfigured')
      const record = await ask({ v: DESK_LINK_PROTOCOL, type: 'snapshot' })
      if (!record || record.ok !== true || !Array.isArray(record.sessions)) {
        return unavailable(typeof record?.reason === 'string' && record.reason ? record.reason : 'desk-link-unavailable')
      }
      return record
    },
    async hostedSessions() {
      if (!resolved) return { ok: false, reason: 'desk-link-unconfigured', sessions: [], scannedAt: null }
      const record = await ask({ v: DESK_LINK_PROTOCOL, type: 'hosted-sessions' })
      if (!record || record.ok !== true || !Array.isArray(record.sessions)) {
        return { ok: false, reason: record?.reason || 'pi host unavailable', sessions: [], scannedAt: record?.scannedAt ?? null }
      }
      return { ok: true, sessions: record.sessions, scannedAt: record.scannedAt }
    },
    /** The Reporting Machines currently connected. Empty when no link answers. */
    async machines() {
      if (!resolved) return []
      const record = await ask({ v: DESK_LINK_PROTOCOL, type: 'machines' })
      return Array.isArray(record?.machines) ? record.machines : []
    },
    async sessionEvents(sessionId, options = {}) {
      if (!resolved || typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, reason: 'desk-link-unconfigured' }
      }
      const record = await ask({ v: DESK_LINK_PROTOCOL, type: 'events', sessionId, ...(options.hostedPi === true ? { hostedPi: true } : {}) })
      if (!record || typeof record !== 'object') return { ok: false, reason: 'desk-link-unavailable' }
      return record.ok === true
        ? { ok: true, events: record.events ?? [], truncated: record.truncated === true }
        : { ok: false, reason: record.reason ?? 'desk-link-unavailable' }
    },
  }
}

module.exports = { createDeskLinkClient, resolveDeskLinkSocketPath, DESK_LINK_PROTOCOL }
