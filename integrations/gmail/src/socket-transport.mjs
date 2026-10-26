import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'

/** Bounded JSON-line MCP transport. SDK request validation remains authoritative. */
export class SocketTransport {
  constructor(socket, { health = false, maxFrame = 8192, frameTimeout = 3000 } = {}) {
    this.socket = socket
    this.health = health
    this.maxFrame = maxFrame
    this.frameTimeout = frameTimeout
    this.pending = Buffer.alloc(0)
    this.requests = new Set()
    this.onmessage = undefined
    this.onerror = undefined
    this.onclose = undefined
    this.timer = undefined
    this.started = false
    this.closed = false
  }
  async start() {
    if (this.started) throw Error('Transport already started')
    this.started = true
    this.timer = setTimeout(() => { void this.close() }, this.frameTimeout)
    this.socket.on('error', () => { this.onerror?.(Error('Gmail service session unavailable')); void this.close() })
    this.socket.on('close', () => { this.closed = true; clearTimeout(this.timer); this.onclose?.() })
    this.socket.on('data', chunk => {
      try {
        let offset = 0
        while (offset < chunk.length) {
          const newline = chunk.indexOf(10, offset)
          const end = newline < 0 ? chunk.length : newline + 1
          const part = chunk.subarray(offset, end)
          if (this.pending.length + part.length > this.maxFrame) throw Error('frame')
          this.pending = Buffer.concat([this.pending, part])
          offset = end
          if (newline < 0) break
          const message = JSONRPCMessageSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.pending.subarray(0, -1))))
          this.pending = Buffer.alloc(0)
          clearTimeout(this.timer); this.timer = undefined
          if ('method' in message && 'id' in message) {
            if (this.requests.size >= 4 || this.requests.has(message.id)) throw Error('requests')
            this.requests.add(message.id)
          }
          if (this.health && 'method' in message && message.method === 'odk/health' && 'id' in message) {
            if (message.params !== undefined) throw Error('health')
            void this.send({ jsonrpc: '2.0', id: message.id, result: { ready: true } }).catch(() => this.close())
          } else this.onmessage?.(message)
        }
        if (this.pending.length && !this.timer) this.timer = setTimeout(() => { void this.close() }, this.frameTimeout)
      } catch { void this.close() }
    })
  }
  async send(message) {
    const data = Buffer.from(JSON.stringify(message) + '\n')
    if (this.closed || data.length > 65536 || this.socket.writableLength > 131072) { await this.close(); throw Error('Gmail service response unavailable') }
    if ('id' in message && !('method' in message)) this.requests.delete(message.id)
    await new Promise((resolve, reject) => this.socket.write(data, error => error ? reject(Error('Gmail service response unavailable')) : resolve(undefined)))
  }
  async close() {
    clearTimeout(this.timer)
    this.socket.destroy()
  }
}
