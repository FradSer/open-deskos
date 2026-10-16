// Preserve the production response while capturing only nonsecret inference data.
export async function liveJevResponse(response, questionIds = []) {
  const reader = response.body?.getReader()
  if (!reader) throw Error('Missing live judgment response')
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 32768) throw Error('Oversized live judgment response')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const body = Buffer.concat(chunks)
  let metadata = { status: response.status }
  try {
    const result = JSON.parse(body.toString('utf8'))
    const usage = Object.fromEntries(['input_tokens', 'output_tokens'].filter(key => Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0).map(key => [key, result.usage[key]]))
    const rawAnswers = Object.fromEntries(questionIds.flatMap(key => {
      const answer = result.answers?.[key]
      return answer?.type === 'noul' && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1 ? [[key, { type: 'noul', noul: answer.noul }]] : []
    }))
    metadata = { ...metadata, usage, rawAnswers }
  } catch { /* The production parser reports a sanitized failure. */ }
  return { response: new Response(body, { status: response.status, headers: response.headers }), metadata }
}
