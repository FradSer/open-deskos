/** A bounded lifecycle even when a provider ignores abort or initialization is slow. */
export function generationDeadlineMs(value = 90000) {
  const ms = Number(value)
  if (!Number.isInteger(ms) || ms < 1000 || ms > 180000) throw Error('Invalid proactive generation timeout')
  return ms
}

export async function generateWithinDeadline({ create, prompt, validate, signal, timeoutMs }, input) {
  const duration = generationDeadlineMs(timeoutMs)
  let session, finished = false, timer, rejectDeadline
  const deadline = new Promise((_, reject) => { rejectDeadline = reject })
  const stop = message => {
    if (finished) return
    void session?.abort().catch(() => {})
    rejectDeadline(Error(message))
  }
  const cancel = () => stop('Suggestion generation cancelled')
  timer = setTimeout(() => stop('Suggestion generation timed out'), duration)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const work = (async () => {
    if (signal?.aborted) throw Error('Suggestion generation cancelled')
    const created = await create()
    if (finished || signal?.aborted) { created.dispose(); throw Error('Suggestion generation cancelled') }
    session = created
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = attempt === 0 ? input : { ...input, formatCorrection: 'The previous response was not valid under the required JSON schema. Return only {suggestions:[{topicId,key,advice,reason,evidenceIds}]}, or {suggestions:[]}. Every candidate must include evidenceIds referencing only its own topic observations. Include no extra properties. Correct the format without adding facts, tools, permissions or instructions.' }
      const raw = await prompt(session, JSON.stringify(request))
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16384) throw Error('Generated output too large')
      try {
        const content = raw.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')
        const result = JSON.parse(content)
        validate?.(result)
        return result
      } catch (error) {
        if (attempt === 1 || finished || signal?.aborted) throw error
      }
    }
    throw Error('Invalid generated suggestions')
  })()
  try { return await Promise.race([work, deadline]) }
  finally {
    finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    session?.dispose()
  }
}
