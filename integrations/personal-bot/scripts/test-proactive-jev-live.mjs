import { createJevJudge } from '../src/proactive-jev.mjs'
import { proactiveJevCases, proactiveJevInput } from '../tests/fixtures/proactive-jev-cases.mjs'
import { liveJevResponse } from '../tests/fixtures/live-jev-response.mjs'

// Explicit invocation only. Uses synthetic observations and real Jev without actions.
const selected = process.argv.slice(2)
if (selected.some(id => !proactiveJevCases.some(sample => sample.id === id))) throw Error('Unknown synthetic case')
const cases = selected.length ? proactiveJevCases.filter(sample => selected.includes(sample.id)) : proactiveJevCases
let metadata
const judge = createJevJudge({ fetchImpl: async (url, options) => {
  const captured = await liveJevResponse(await fetch(url, options), Object.keys(JSON.parse(options.body).questions))
  metadata = captured.metadata
  return captured.response
} })
let failed = 0
for (const sample of cases) {
  const started = performance.now()
  metadata = {}
  try {
    const result = await judge(proactiveJevInput(sample))
    const answer = result.answers.c0
    const actual = answer.probability >= answer.threshold && answer.groundingProbability >= answer.threshold
    const passed = actual === sample.expected
    if (!passed) failed++
    console.log(JSON.stringify({ id: sample.id, expected: sample.expected, actual, passed, model: result.model, ...answer, ...metadata, elapsedMs: Math.round(performance.now() - started) }))
  } catch {
    failed++
    console.log(JSON.stringify({ id: sample.id, passed: false, error: 'Live Jev unavailable or invalid response', ...metadata }))
  }
}
console.log(JSON.stringify({ cases: cases.length, passed: cases.length - failed, failed }))
if (failed) process.exitCode = 1
