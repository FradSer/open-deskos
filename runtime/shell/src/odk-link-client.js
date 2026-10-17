const net = require('node:net')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')
const { isNamedPipe, readOrCreateToken, requiresToken, writeHandshake } = require('./local-channel')
const { resolveShellHost } = require('./platform')
const { createPiReadSource } = require('./pi-read-source')

const ODK_LINK_PROTOCOL = 1
// Runtime snapshots include workspace membership as well as the session list.
// Keep their cap separate from a reporter's 64 KiB inbound message budget.
const MAX_RUNTIME_RESPONSE_BYTES = 2 * 1024 * 1024

function resolveOdkLinkSocketPath(env = process.env, host = null) {
  if (env.ODK_SHELL_TEST_MODE === '1' && env.ODK_LINK_SOCKET) {
    if (!path.isAbsolute(env.ODK_LINK_SOCKET) && !isNamedPipe(env.ODK_LINK_SOCKET)) {
      throw new Error('ODK_LINK_SOCKET must be an absolute Unix socket path or a named pipe')
    }
    return env.ODK_LINK_SOCKET
  }
  // A Windows host has no runtime directory to lay a socket out in, so the
  // endpoint comes from the platform's own naming: a named pipe either way.
  const resolved = host || resolveShellHost({ env })
  return resolved.endpoint('odk-link')
}

/**
 * One request per connection: a snapshot is always read fresh, never a push
 * that could age past its own scan time.
 */
function request(socketPath, record, timeoutMs = 2000, channel = {}) {
  return new Promise((resolve) => {
    if (channel.signal?.aborted) return resolve(null)
    let settled = false
    let result = null
    let remainder = ''
    let receivedBytes = 0
    const decoder = new StringDecoder('utf8')
    const finish = (value) => {
      if (settled) return
      settled = true
      result = value
      socket.destroy()
    }
    const socket = net.createConnection(socketPath)
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => {
      if (settled || channel.signal?.aborted) return finish(null)
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
    const abort = () => finish(null)
    socket.on('close', () => {
      channel.signal?.removeEventListener('abort', abort)
      resolve(channel.signal?.aborted ? null : result)
    })
    channel.signal?.addEventListener('abort', abort, { once: true })
  })
}

function createOdkLinkTransport({ socketPath, env = process.env, send = request, token = '', platform = process.platform, host = null } = {}) {
  const resolvedHost = host || resolveShellHost({ env, platform })
  const resolved = socketPath ?? resolveOdkLinkSocketPath(env, resolvedHost)
  const needsToken = Boolean(resolved) && requiresToken({ endpoint: resolved, platform })

  // The token is read when the endpoint needs one, not when the client is
  // created, because the Shell builds its client before anything is listening.
  let tokenPromise = null
  async function channelToken() {
    if (token) return token
    if (!needsToken) return ''
    if (!tokenPromise) tokenPromise = readOrCreateToken({ stateDir: resolvedHost.stateDir })
    return tokenPromise
  }

  return { socketPath: resolved, async request(record, { signal } = {}) {
    if (signal?.aborted) return null
    try {
      const credential = await channelToken()
      if (signal?.aborted) return null
      const value = await send(resolved, record, undefined, { endpoint: resolved, platform, token: credential, signal })
      return signal?.aborted ? null : value
    } catch (error) {
      if (signal?.aborted) return null
      throw error
    }
  } }
}

function createOdkLinkClient({ signal, ...options } = {}) {
  const transport = createOdkLinkTransport(options)
  const resolved = transport.socketPath
  const unavailable = (reason) => ({ ok: false, reason, scannedAt: null, summary: null, sessions: [], workspaces: [] })
  const ask = createPiReadSource({ signal, unavailable: () => null, read: (ownerSignal, _own, record, requestSignal) => {
    const active = requestSignal ? AbortSignal.any([ownerSignal, requestSignal]) : ownerSignal
    return transport.request(record, { signal: active })
  } })
  let stopped = false
  const response = (record, options) => stopped || signal?.aborted || options.signal?.aborted ? null : record

  return {
    socketPath: resolved,
    async stop() { stopped = true; await ask.stop() },
    async snapshot(options = {}) {
      if (!resolved) return unavailable('odk-link-unconfigured')
      const record = response(await ask({ v: ODK_LINK_PROTOCOL, type: 'snapshot' }, options.signal), options)
      if (!record || record.ok !== true || !Array.isArray(record.sessions)) {
        return unavailable(typeof record?.reason === 'string' && record.reason ? record.reason : 'odk-link-unavailable')
      }
      return record
    },
    async conclusions({ cursor = null, limit = 16, signal } = {}) {
      const record = response(await ask({ v: ODK_LINK_PROTOCOL, type: 'conclusions', cursor, limit }, signal), { signal })
      return record?.ok === true && Array.isArray(record.records) ? record : { ok:false, reason:record?.reason==='cursor_expired'?'cursor_expired':'conclusions_unavailable', records:[] }
    },
    async hostedSessions(options = {}) {
      if (!resolved) return { ok: false, reason: 'odk-link-unconfigured', sessions: [], scannedAt: null }
      const record = response(await ask({ v: ODK_LINK_PROTOCOL, type: 'hosted-sessions' }, options.signal), options)
      if (!record || record.ok !== true || !Array.isArray(record.sessions)) {
        return { ok: false, reason: record?.reason || 'pi host unavailable', sessions: [], scannedAt: record?.scannedAt ?? null }
      }
      return { ok: true, sessions: record.sessions, scannedAt: record.scannedAt }
    },
    /** The Reporting Machines currently connected. Empty when no link answers. */
    async machines(options = {}) {
      if (!resolved) return []
      const record = response(await ask({ v: ODK_LINK_PROTOCOL, type: 'machines' }, options.signal), options)
      return Array.isArray(record?.machines) ? record.machines : []
    },
    async sessionEvents(sessionId, options = {}) {
      if (!resolved || typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, reason: 'odk-link-unconfigured' }
      }
      const record = response(await ask({ v: ODK_LINK_PROTOCOL, type: 'events', sessionId, ...(options.hostedPi === true ? { hostedPi: true } : {}) }, options.signal), options)
      if (!record || typeof record !== 'object') return { ok: false, reason: 'odk-link-unavailable' }
      return record.ok === true
        ? { ok: true, events: record.events ?? [], truncated: record.truncated === true }
        : { ok: false, reason: record.reason ?? 'odk-link-unavailable' }
    },
  }
}

module.exports = { createOdkLinkClient, createOdkLinkTransport, resolveOdkLinkSocketPath, ODK_LINK_PROTOCOL }
