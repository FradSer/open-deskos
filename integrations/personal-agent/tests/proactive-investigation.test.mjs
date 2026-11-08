import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProactiveInvestigationTools } from '../src/proactive-investigation.mjs'
import { validateGeneratedBatch } from '../src/recommendations/index.mjs'
import { openuiSuggestion, uiTypes } from './openui-fixtures.test.mjs'

const stamp = '2026-11-02T09:40:00.000Z'
const action = { id: 'open', label: 'Open the plan' }
const reading = (id, field, value) => ({ id, readingId: 'commute.traffic', field, value, state: 'live', measuredAt: stamp })
const topic = () => ({
  id: 'commute-anomaly', goal: 'Tell me when the commute departs from its normal duration.',
  urgent: false, delivery: 'immediate', actions: [action],
  evidence: [reading('e0', 'minutes', 52), reading('e1', 'baselineMinutes', 24), reading('e2', 'delayMinutes', 28)],
})
const fixture = ({ read = async () => ({ reading: { id: 'commute.traffic', state: 'live', label: '通勤', value: { minutes: 52 } } }) } = {}) => {
  const input = { trigger: { kind: 'heartbeat', readingIds: [] }, context: { now: stamp }, topics: [topic()], recent: [], maxCandidates: 8 }
  const calls = { read: [] }
  const investigation = createProactiveInvestigationTools({
    input,
    read: async (id, signal) => { calls.read.push(id); return read(id, signal) },
  })
  return { investigation, calls }
}

test('the generation session exposes only the scoped read tool', () => {
  const { investigation } = fixture()
  assert.deepEqual(investigation.tools.map(tool => tool.name), ['proactive_read'])
  assert.match(investigation.tools[0].description, /never adds citable evidence/)
})

test('a scoped read returns the current reading for a cited source', async () => {
  const { investigation, calls } = fixture()
  const outcome = await investigation.tools[0].execute('t0', { readingId: 'commute.traffic' })
  assert.deepEqual(calls.read, ['commute.traffic'])
  assert.equal(outcome.structuredContent.reading.value.minutes, 52)
})

test('a reading outside this round has no citation scope and is refused', async () => {
  const { investigation, calls } = fixture()
  await assert.rejects(investigation.tools[0].execute('t0', { readingId: 'weather.outdoor' }), /not cited by this round/)
  assert.deepEqual(calls.read, [])
})

test('reads stay within the bounded budget', async () => {
  const { investigation, calls } = fixture()
  for (let index = 0; index < 8; index++) await investigation.tools[0].execute('t0', { readingId: 'commute.traffic' })
  await assert.rejects(investigation.tools[0].execute('t0', { readingId: 'commute.traffic' }), /budget/)
  assert.equal(calls.read.length, 8)
})

test('the host passes an OpenUI tree through validation unchanged', () => {
  const ui = openuiSuggestion({ topicId: 'commute-anomaly', key: 'primary', advice: '通勤延误 28 分钟。', actionId: action.id, evidenceIds: ['e0', 'e1', 'e2'] }).ui
  const [validated] = validateGeneratedBatch({ suggestions: [{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤延误 28 分钟。', actionId: action.id, evidenceIds: ['e0', 'e1', 'e2'], ui }] }, [topic()], 8)
  assert.deepEqual(validated.ui, ui)
  assert.ok(uiTypes(validated.ui).includes('Badge'))
})
