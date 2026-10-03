import { readProactiveFile } from './proactive-private.mjs'

export const isJevModel = value => typeof value === 'string' && /^jev-[a-zA-Z0-9.-]{1,60}$/.test(value)

/** Shared bounded, server-side TypeSafe transport for intent and proactive judgments. */
export function createJevClient({ env = process.env, fetchImpl = fetch } = {}) {
  const key = env.TYPESAFE_API_KEY?.trim() || (env.ODESK_JEV_KEY_FILE ? readProactiveFile(env.ODESK_JEV_KEY_FILE, 4096).trim() : '')
  if (!key || /[\r\n]/.test(key)) throw Error('Jev credential missing or invalid')
  const model = env.ODESK_JEV_MODEL || 'jev-latest'
  const timeout = Number(env.ODESK_JEV_TIMEOUT_MS ?? 10000)
  if (!isJevModel(model) || !Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) throw Error('Invalid Jev configuration')
  return async ({ state, questions, signal = undefined }) => {
    try {
      signal?.throwIfAborted()
      const body = JSON.stringify({ model, state, questions })
      if (Buffer.byteLength(body) > 96000) throw Error()
      const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      })
      if (!response.ok) { await response.body?.cancel(); throw Error() }
      const reader = response.body?.getReader()
      if (!reader) throw Error()
      const chunks = []; let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break
          size += value.byteLength
          if (size > 32768) throw Error()
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      signal?.throwIfAborted()
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isJevModel(result?.model) || !result.answers || Array.isArray(result.answers)
          || Object.keys(result.answers).length !== Object.keys(questions).length
          || Object.keys(questions).some(id => !Object.hasOwn(result.answers, id))) throw Error()
      return result
    } catch {
      signal?.throwIfAborted()
      throw Error('Jev unavailable or invalid response')
    }
  }
}
