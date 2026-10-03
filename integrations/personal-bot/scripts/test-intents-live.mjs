import { createJevIntentRouter } from '../src/intent-routing.mjs'
import { intentCases } from '../tests/fixtures/intent-cases.mjs'

// Explicit manual invocation only. Calls Jev with synthetic text and never
// creates a Personal Bot, task, application, order or operational service.
const selected = process.argv.slice(2)
if (selected.some(id => !intentCases.some(c => c.id === id))) throw Error('Unknown synthetic case')
const cases = selected.length ? intentCases.filter(c => selected.includes(c.id)) : intentCases
let metadata = {}
const router = createJevIntentRouter({ fetchImpl: async (url, options) => {
  const response = await fetch(url, options)
  const reader = response.body?.getReader()
  if (!reader) return response
  const chunks = []; let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      bytes += value.byteLength
      if (bytes > 32768) throw Error('Oversized live inference response')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const body = Buffer.concat(chunks)
  metadata = { status: response.status }
  try {
    const result = JSON.parse(body.toString('utf8'))
    metadata = { ...metadata, inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens }
  } catch { /* Production parser reports a sanitized failure. */ }
  return new Response(body, { status: response.status, headers: response.headers })
} })

let failed = 0
for (const { id, input, expected } of cases) {
  const start = performance.now()
  metadata = {}
  try {
    const result = await router(input)
    const passed = result.intent === expected
    if (!passed) failed++
    console.log(JSON.stringify({ id, expected, passed, actual: result.intent, choice: result.choice, confidence: result.confidence,
      probability: result.probabilities[result.choice], model: result.model, latencyMs: Math.round(performance.now() - start), ...metadata }))
  } catch {
    failed++
    console.log(JSON.stringify({ id, expected, passed: false, error: 'Jev unavailable or invalid response', latencyMs: Math.round(performance.now() - start), ...metadata }))
  }
}
console.log(JSON.stringify({ cases: cases.length, passed: cases.length - failed, failed }))
if (failed) process.exitCode = 1
