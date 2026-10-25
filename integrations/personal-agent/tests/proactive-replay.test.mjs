import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/proactive.mjs'
import { evaluateProactiveReplay } from '../scripts/evaluate-proactive.mjs'

test('offline replay covers lifecycle outcomes without provider or action calls', async () => {
  const report = await evaluateProactiveReplay()
  assert.equal(report.passed, true)
  assert.equal(report.scenarios.length, 8)
  assert(report.scenarios.every(item => item.passed))
  assert.equal(report.calls.actions, 0)
  assert.equal(report.realModel, false)
  assert.equal(report.calibration, 'not_measured')
})

test('offline replay detects excess calls when generation reuse is disabled', async () => {
  const report = await evaluateProactiveReplay({ createWatch: options =>
    new ProactiveWatch({ ...options, config: { ...options.config, generationIntervalMs: 0 } }) })
  assert.equal(report.passed, false)
  assert.equal(report.scenarios.find(item => item.id === 'unchanged-observation-reuses-generation').passed, false)
  assert.deepEqual(report.scenarios.find(item => item.id === 'unchanged-observation-reuses-generation').diagnostic,
    { code: 'ERR_ASSERTION', operator: 'strictEqual', actual: 2, expected: 1 })
})
