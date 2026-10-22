import { ModelRuntime } from '@earendil-works/pi-coding-agent'

export const isJevModel = value => typeof value === 'string' && /^jev-[a-zA-Z0-9_.-]{1,60}$/.test(value)

// Only fixed codes cross the resident status boundary; never retain upstream bodies or credentials.
class JevRequestError extends Error {
  constructor(code, message = 'Jev unavailable or invalid response') { super(message); this.code = code }
}

/** Bound bytes before Pi parses successful or failed classifier responses. */
async function boundedResponse(response, onFailure) {
  const limit = 32768
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {})
    onFailure(); throw new JevRequestError('invalid_response')
  }
  if (!response.body) throw new JevRequestError('invalid_response')
  const reader = response.body.getReader()
  let size = 0
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const {done, value} = await reader.read()
        if (done) { controller.close(); return }
        size += value.byteLength
        if (size > limit) {
          onFailure()
          await reader.cancel().catch(() => {})
          controller.error(new JevRequestError('invalid_response'))
        } else controller.enqueue(value)
      } catch (error) { await reader.cancel().catch(() => {}); controller.error(error) }
    },
    cancel: reason => reader.cancel(reason),
  }), {status: response.status, statusText: response.statusText, headers: response.headers})
}

/** Native Pi classifier adapter. Host judgments retain their existing Noul contract. */
export function createJevClient({ env = process.env, fetchImpl = fetch, runtime = undefined } = {}) {
  const provider = env.ODK_JEV_PROVIDER || 'typesafe'
  if (!['typesafe', 'opencode'].includes(provider)) throw new JevRequestError('configuration', 'Invalid Jev provider configuration')
  const model = env.ODK_JEV_MODEL || (provider === 'opencode' ? 'jev-1.13' : 'jev-latest')
  const timeout = Number(env.ODK_JEV_TIMEOUT_MS ?? 10000)
  if (!isJevModel(model) || !Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) throw new JevRequestError('configuration', 'Invalid Jev configuration')
  let nativeRuntime
  return async ({ state, questions, signal = undefined }) => {
    const deadline = AbortSignal.timeout(timeout)
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    let status, received = false, transportError, responseError
    try {
      requestSignal.throwIfAborted()
      if (!questions || !Object.keys(questions).length || Object.keys(questions).length > 256
        || Buffer.byteLength(JSON.stringify({state, questions})) > 96000) throw new JevRequestError('configuration')
      nativeRuntime ??= runtime ? Promise.resolve(typeof runtime === 'function' ? runtime() : runtime) : ModelRuntime.create({signal: requestSignal})
      const models = await nativeRuntime
      const selected = models.getModelOfType('classifier', provider, model)
      if (!selected) throw new JevRequestError('configuration')
      if (!await models.getAuth(selected, {signal: requestSignal, env})) throw new JevRequestError('missing_credential', 'Jev credential missing or unavailable')
      requestSignal.throwIfAborted()
      const nativeQuestions = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, {
        ...question, type: question.type === 'noul' ? 'bool' : question.type,
        instructions: typeof question.instructions === 'string' ? question.instructions : JSON.stringify(question.instructions),
      }]))
      const result = await models.classify(selected, {state, questions: nativeQuestions}, {
        signal: requestSignal, env, maxRetries: 0, timeoutMs: timeout,
        // Pi constructs, authenticates and parses the request. Keep the host's redirect policy
        // and capture only failure categories, never upstream bodies or credential details.
        fetch: async (url, options) => {
          try {
            const response = await fetchImpl(url, {...options, redirect: 'error'})
            received = true; status = response.status
            return await boundedResponse(response, () => { responseError = 'invalid_response' })
          } catch (error) { transportError = error?.name; throw error }
        },
      })
      requestSignal.throwIfAborted()
      if (result.stopReason !== 'stop') throw new JevRequestError(
        responseError ?? (status === 401 || status === 403 ? 'auth_rejected' : status === 429 ? 'rate_limited'
          : status >= 500 ? 'upstream' : status >= 400 ? 'request_rejected'
            : transportError === 'TimeoutError' ? 'timeout' : received ? 'invalid_response' : 'network'))
      if (!isJevModel(result.model) || !result.answers || Array.isArray(result.answers)
        || Object.keys(result.answers).length !== Object.keys(questions).length) throw new JevRequestError('invalid_response')
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
        const answer = result.answers[id]
        if (!answer || answer.type !== nativeQuestions[id].type) throw new JevRequestError('invalid_response')
        if (question.type === 'noul') {
          if (!Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) throw new JevRequestError('invalid_response')
          return [id, {type: 'noul', noul: answer.probability}]
        }
        return [id, answer]
      }))
      return {model: result.model, answers}
    } catch (error) {
      signal?.throwIfAborted()
      if (deadline.aborted || error?.name === 'TimeoutError') throw new JevRequestError('timeout')
      if (error instanceof JevRequestError) throw error
      throw new JevRequestError('network')
    }
  }
}


/** One public startup request verifies access and typed response shape, not any owner intent. */
export async function checkJevAuthentication({ env = process.env, fetchImpl = fetch, signal = undefined, runtime = undefined } = {}) {
  signal?.throwIfAborted()
  if (env.ODK_JEV_PROVIDER === 'disabled') return { status: 'disabled' }
  try {
    const request = createJevClient({ env, fetchImpl, runtime })
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
