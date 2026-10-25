import http from 'node:http'
import { isAbsolute, normalize } from 'node:path'

const REQUEST_LIMIT = 64 * 1024
const RESPONSE_LIMIT = 128 * 1024
const METHODS = new Set(['submit', 'status', 'result', 'cancel', 'resume'])
const MUTATIONS = new Set(['submit', 'cancel', 'resume'])

/** A bounded, non-retrying client for the operator-owned private Unix socket.
 * @param {{socketPath: string, timeoutMs?: number}} config
 * @param {{signal?: AbortSignal}} [options]
 */
export function createDesktopAgentClient({ socketPath, timeoutMs = 10000 }, { signal: lifetimeSignal } = {}) {
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath) || normalize(socketPath) !== socketPath || /[\x00-\x1f\x7f]/.test(socketPath)) throw Error('Invalid desktop agent socket')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw Error('Invalid desktop agent timeout')
  const lifetime = new AbortController()
  let closed = false
  return {
    async request(method, params, signal) {
      if (!METHODS.has(method)) throw Error('Invalid desktop agent method')
      if (closed) throw Error('Desktop agent client is closed')
      const body = JSON.stringify({ method, params })
      if (Buffer.byteLength(body) > REQUEST_LIMIT) throw Error('Desktop agent request exceeds limit')
      const callSignal = AbortSignal.any([lifetime.signal, ...(lifetimeSignal ? [lifetimeSignal] : []), ...(signal ? [signal] : [])])
      callSignal.throwIfAborted()
      return new Promise((resolve, reject) => {
        let settled = false
        const fail = () => { if (!settled) { settled = true; reject(Error(MUTATIONS.has(method) ? 'Desktop agent outcome_unknown; retain the request or task identity and reconcile without automatic retry' : 'Desktop agent observation_unavailable')) } }
        const request = http.request({ socketPath, path: '/rpc', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, signal: callSignal }, response => {
          let bytes = 0
          const chunks = []
          response.on('data', chunk => {
            bytes += chunk.length
            if (bytes > RESPONSE_LIMIT) { fail(); request.destroy(); response.destroy(); return }
            chunks.push(chunk)
          })
          response.on('error', fail)
          response.on('aborted', fail)
          response.on('end', () => {
            if (settled) return
            try {
              const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              if (response.statusCode !== 200 || typeof envelope !== 'object' || !envelope) { fail(); return }
              if (envelope.ok === false && /^[a-z][a-z0-9_]{0,63}$/.test(envelope.error?.code ?? '')) {
                settled = true
                reject(Error(`Desktop agent refused: ${envelope.error.code}`))
                return
              }
              if (envelope.ok !== true || !envelope.result || typeof envelope.result !== 'object' || Array.isArray(envelope.result)) { fail(); return }
              settled = true
              resolve(envelope.result)
            } catch { fail() }
          })
        })
        const timer = setTimeout(() => { fail(); request.destroy() }, timeoutMs)
        request.on('close', () => clearTimeout(timer))
        request.on('error', fail)
        request.end(body)
      })
    },
    close() { closed = true; lifetime.abort() },
  }
}
