import { resolveProviderCredential, resolveProviderEndpoint, ProviderConfigurationError } from './provider-endpoints.mjs'

export const isJevModel = value => typeof value === 'string' && /^jev-[a-zA-Z0-9_.-]{1,60}$/.test(value)

// Only fixed codes cross the resident status boundary; never retain upstream bodies or credentials.
class JevRequestError extends Error {
  constructor(code, message = 'Jev unavailable or invalid response') { super(message); this.code = code }
}

/** Shared bounded, server-side TypeSafe transport for intent and proactive judgments. */
export function createJevClient({ env = process.env, fetchImpl = fetch } = {}) {
  const provider = env.ODK_JEV_PROVIDER || 'typesafe'
  if (!['typesafe', 'opencode'].includes(provider)) throw new JevRequestError('configuration', 'Invalid Jev provider configuration')
  let key, endpoint
  try { endpoint = resolveProviderEndpoint(provider, 'systemone'); key = resolveProviderCredential(provider, { env }) }
  catch (error) { throw new JevRequestError(error instanceof ProviderConfigurationError ? error.code : 'configuration', 'Jev credential missing or invalid') }
  const model = env.ODK_JEV_MODEL || (provider === 'opencode' ? 'jev-1.13' : 'jev-latest')
  const timeout = Number(env.ODK_JEV_TIMEOUT_MS ?? 10000)
  if (!isJevModel(model) || !Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) throw new JevRequestError('configuration', 'Invalid Jev configuration')
  return async ({ state, questions, signal = undefined }) => {
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeout)
    let phase = 'request'
    try {
      signal?.throwIfAborted()
      const body = JSON.stringify({ model, state, questions })
      if (Buffer.byteLength(body) > 96000) throw new JevRequestError('configuration')
      const response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body,
        signal: signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal,
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        throw new JevRequestError([401, 403].includes(response.status) ? 'auth_rejected'
          : response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'upstream' : 'request_rejected')
      }
      const reader = response.body?.getReader()
      if (!reader) throw new JevRequestError('invalid_response')
      const chunks = []; let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break
          size += value.byteLength
          if (size > 32768) throw new JevRequestError('invalid_response')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      signal?.throwIfAborted()
      phase = 'response'
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!isJevModel(result?.model) || !result.answers || Array.isArray(result.answers)
          || Object.keys(result.answers).length !== Object.keys(questions).length
          || Object.keys(questions).some(id => !Object.hasOwn(result.answers, id))) throw Error()
      return result
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof JevRequestError) throw error
      throw new JevRequestError(timeoutController.signal.aborted || error?.name === 'TimeoutError' ? 'timeout'
        : phase === 'request' ? 'network' : 'invalid_response')
    } finally { clearTimeout(timer) }
  }
}


/** One public startup request verifies access and typed response shape, not any owner intent. */
export async function checkJevAuthentication({ env = process.env, fetchImpl = fetch, signal = undefined } = {}) {
  signal?.throwIfAborted()
  if (env.ODK_JEV_PROVIDER === 'disabled') return { status: 'disabled' }
  try {
    const request = createJevClient({ env, fetchImpl })
    const result = await request({ signal,
      state: { purpose: 'Open DeskOS startup authentication check', sample: 'The desk is checking its Jev connection.' },
      questions: { startup: { type: 'noul', instructions: 'Does the supplied sample say that the desk is checking its Jev connection?',
        criteria: { true: 'The sample describes the connection check.', false: 'The sample does not describe the connection check.' } } },
    })
    const answer = result.answers.startup
    if (answer?.type !== 'noul' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new JevRequestError('invalid_response')
    return { status: 'verified' }
  } catch (error) {
    signal?.throwIfAborted()
    const code = error instanceof JevRequestError ? error.code : 'configuration'
    return ['missing_credential', 'auth_rejected'].includes(code) ? { status: code } : { status: 'unavailable', reason: code }
  }
}
