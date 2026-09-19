const net = require('node:net')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')

const DESK_LINK_PROTOCOL = 1
// Runtime snapshots include workspace membership as well as the session list.
// Keep their cap separate from a reporter's 64 KiB inbound message budget.
const MAX_RUNTIME_RESPONSE_BYTES = 2 * 1024 * 1024

function resolveDeskLinkSocketPath(env = process.env) {
  if (env.ODESK_SHELL_TEST_MODE === '1' && env.ODESK_DESK_LINK_SOCKET) {
    if (!path.isAbsolute(env.ODESK_DESK_LINK_SOCKET)) {
      throw new Error('ODESK_DESK_LINK_SOCKET must be an absolute Unix socket path')
    }
    return env.ODESK_DESK_LINK_SOCKET
  }
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (!runtimeDir || !path.isAbsolute(runtimeDir)) return null
  return path.join(runtimeDir, 'open-deskos-desk-link', 'service.sock')
}

/**
 * One request per connection: a snapshot is always read fresh, never a push
 * that could age past its own scan time.
 */
function request(socketPath, record, timeoutMs = 2000) {
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
    socket.on('connect', () => socket.write(`${JSON.stringify(record)}\n`))
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

function createDeskLinkClient({ socketPath, env = process.env, send = request } = {}) {
  const resolved = socketPath ?? resolveDeskLinkSocketPath(env)
  const unavailable = (reason) => ({ ok: false, reason, scannedAt: null, summary: null, sessions: [], workspaces: [] })

  return {
    socketPath: resolved,
    async snapshot() {
      if (!resolved) return unavailable('desk-link-unconfigured')
      const record = await send(resolved, { v: DESK_LINK_PROTOCOL, type: 'snapshot' })
      if (!record || record.ok !== true || !Array.isArray(record.sessions)) return unavailable('desk-link-unavailable')
      return record
    },
    /** The Reporting Machines currently connected. Empty when no link answers. */
    async machines() {
      if (!resolved) return []
      const record = await send(resolved, { v: DESK_LINK_PROTOCOL, type: 'machines' })
      return Array.isArray(record?.machines) ? record.machines : []
    },
    async sessionEvents(sessionId) {
      if (!resolved || typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, reason: 'desk-link-unconfigured' }
      }
      const record = await send(resolved, { v: DESK_LINK_PROTOCOL, type: 'events', sessionId })
      if (!record || typeof record !== 'object') return { ok: false, reason: 'desk-link-unavailable' }
      return record.ok === true ? { ok: true, events: record.events ?? [], truncated: true } : { ok: false, reason: record.reason ?? 'desk-link-unavailable' }
    },
  }
}

module.exports = { createDeskLinkClient, resolveDeskLinkSocketPath, DESK_LINK_PROTOCOL }
