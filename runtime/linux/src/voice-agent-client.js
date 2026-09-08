const net = require('node:net')
const path = require('node:path')

const STATES = new Set(['idle', 'recording', 'transcribing', 'thinking', 'error'])

function resolveVoiceSocketPath(env = process.env) {
  const dir = env.XDG_RUNTIME_DIR
  return dir && path.isAbsolute(dir) ? path.join(dir, 'open-deskos-voice', 'agent.sock') : null
}

function createVoiceAgentClient({ socketPath, reconnectDelayMs = 1000 } = {}) {
  let socket = null
  let connected = false
  let running = false
  let timer = null
  let status = { state: 'unavailable', message: 'Voice service unavailable' }
  const listeners = new Set()

  function publish(next) {
    status = next
    for (const listener of listeners) listener({ ...status })
  }

  function write(type) {
    if (!connected || !socket || socket.destroyed) return false
    socket.write(`${JSON.stringify({ v: 1, type })}\n`)
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
      write('status')
    })
    active.on('data', (chunk) => {
      remainder += chunk
      const lines = remainder.split('\n')
      remainder = lines.pop()
      if (Buffer.byteLength(remainder) > 8192) return active.destroy()
      for (const line of lines) {
        if (Buffer.byteLength(line) > 8192) return active.destroy()
        let record
        try { record = JSON.parse(line) } catch { continue }
        if (record?.v !== 1 || record.type !== 'status' || !STATES.has(record.state)) continue
        publish({ state: record.state, message: typeof record.message === 'string' ? record.message.slice(0, 1024) : '' })
      }
    })
    active.on('error', () => {})
    active.once('close', () => {
      if (socket !== active) return
      connected = false
      socket = null
      publish({ state: 'unavailable', message: 'Voice service unavailable' })
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
    snapshot: () => ({ ...status }),
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...status })
      return () => listeners.delete(listener)
    },
  }
}

module.exports = { createVoiceAgentClient, resolveVoiceSocketPath }
