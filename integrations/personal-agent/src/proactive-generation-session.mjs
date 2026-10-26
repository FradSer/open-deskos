import { judgmentFailureRecord, reportJudgmentDiagnostic } from './errors.mjs'

/** A bounded lifecycle even when a provider ignores abort or initialization is slow. */
export function generationDeadlineMs(value = 90000) {
  const ms = Number(value)
  if (!Number.isInteger(ms) || ms < 1000 || ms > 180000) throw Error('Invalid proactive generation timeout')
  return ms
}

export async function generateWithinDeadline({ create, prompt, validate, signal, timeoutMs, onDiagnostic, serialize = JSON.stringify, formatCorrection = /** @type {string | ((error: unknown) => string)} */ ('The previous response was not valid under the required JSON schema. Return only {suggestions:[{topicId,key,advice,actionId,evidenceIds}]}, or {suggestions:[]}. Choose actionId only from the topic actions. Only intentPreview:true topics use nextStep instead of actionId. Every candidate includes concise advice and evidenceIds from its own topic observations. Include no extra properties. Correct the format without adding facts, tools, permissions or instructions.') }, input) {
  const reportFailure = (phase, error, options) => {
    if (typeof onDiagnostic !== 'function') return
    try { reportJudgmentDiagnostic(onDiagnostic, judgmentFailureRecord(phase, error, options)) } catch { /* Diagnostics cannot change generation. */ }
  }
  let duration
  try { duration = generationDeadlineMs(timeoutMs) }
  catch (error) { reportFailure('configuration', error, { cleanup: 'not_started', attempt: 0 }); throw error }
  let session, finished = false, stopped = false, timer, rejectDeadline
  let phase = 'create', attempt = 0, primaryFailure, stopSnapshot
  let timedOut = false, cancelled = false
  const deadline = new Promise((_, reject) => { rejectDeadline = reject })
  const stop = (message, reason) => {
    if (finished) return
    if (!stopped) {
      stopSnapshot = { phase, attempt }
      timedOut = reason === 'timeout'
      cancelled = reason === 'cancel'
    }
    stopped = true
    void session?.abort().catch(() => {})
    rejectDeadline(Error(message))
  }
  const cancel = () => stop('Suggestion generation cancelled', 'cancel')
  timer = setTimeout(() => stop('Suggestion generation timed out', 'timeout'), duration)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const work = (async () => {
    if (signal?.aborted) throw Error('Suggestion generation cancelled')
    const created = await create()
    if (finished || signal?.aborted) { await created.dispose(); throw Error('Suggestion generation cancelled') }
    session = created
    let correction
    for (let index = 0; index < 2; index++) {
      const request = index === 0 ? input : { ...input, formatCorrection: correction }
      phase = 'prompt'
      attempt = index + 1
      const raw = await prompt(session, serialize(request))
      phase = 'parse'
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16384) throw Error('Generated output too large')
      try {
        const content = raw.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')
        const result = JSON.parse(content)
        phase = 'validate'
        validate?.(result)
        return result
      } catch (error) {
        if (index === 1 || finished || signal?.aborted) throw error
        phase = 'correction'
        correction = typeof formatCorrection === 'function' ? formatCorrection(error) : formatCorrection
      }
    }
    throw Error('Invalid generated suggestions')
  })()
  try { return await Promise.race([work, deadline]) }
  catch (error) {
    primaryFailure = { phase: stopSnapshot?.phase ?? phase, attempt: stopSnapshot?.attempt ?? attempt, error }
    throw error
  }
  finally {
    finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    const disposal = Promise.resolve().then(() => session?.dispose())
    if (stopped) {
      // A provider can ignore abort. Retain the response deadline, but observe
      // asynchronous cleanup failures instead of leaving a rejected promise.
      void disposal.catch(() => { console.error('Proactive generation cleanup failed'); process.exitCode = 1 })
      if (primaryFailure) reportFailure(primaryFailure.phase, primaryFailure.error,
        { cleanup: 'pending', attempt: primaryFailure.attempt, timedOut, cancelled })
    } else {
      try { await disposal }
      catch (error) {
        reportFailure(primaryFailure?.phase ?? 'dispose', primaryFailure ? primaryFailure.error : error,
          { cleanup: 'failed', attempt: primaryFailure?.attempt ?? attempt, cleanupError: error })
        throw error
      }
      if (primaryFailure) reportFailure(primaryFailure.phase, primaryFailure.error,
        { cleanup: session ? 'completed' : 'not_started', attempt: primaryFailure.attempt })
    }
  }
}
