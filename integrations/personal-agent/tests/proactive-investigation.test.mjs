import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProactiveInvestigationTools } from '../src/proactive-investigation.mjs'

const stamp = '2026-11-02T09:40:00.000Z'
const action = { id: 'open', label: 'Open the plan' }
const reading = (id, field, value) => ({ id, readingId: 'commute.traffic', field, value, state: 'live', measuredAt: stamp })
const topic = () => ({
  id: 'commute-anomaly', goal: 'Tell me when the commute departs from its normal duration.',
  urgent: false, delivery: 'immediate', actions: [action],
  evidence: [reading('e0', 'minutes', 52), reading('e1', 'baselineMinutes', 24), reading('e2', 'delayMinutes', 28)],
})
const draft = {
  topicId: 'commute-anomaly', key: 'primary', advice: '通勤延误 28 分钟。',
  actionId: action.id, evidenceIds: ['e0', 'e1', 'e2'],
  preview: { summary: '通勤时长对比', items: [{ label: '预计耗时', value: '52 分钟', tone: 'warn' }, { label: '基准耗时', value: '24 分钟' }] },
}
const fixture = ({ judge = async () => ({ model: 'jev-fixture', answers: {} }), read = async () => ({ reading: { id: 'commute.traffic', state: 'live', label: '通勤', value: { minutes: 52 } } }) } = {}) => {
  const input = { trigger: { kind: 'heartbeat', readingIds: [] }, context: { now: stamp }, topics: [topic()], recent: [], maxCandidates: 8 }
  const calls = { judge: [], read: [] }
  const investigation = createProactiveInvestigationTools({
    input,
    judge: async value => { calls.judge.push(value); return judge(value) },
    read: async (id, signal) => { calls.read.push(id); return read(id, signal) },
  })
  return { investigation, calls }
}

test('a scoped read returns the current reading for a cited source', async () => {
  const { investigation, calls } = fixture()
  assert.deepEqual(investigation.tools.map(tool => tool.name), ['proactive_read', 'proactive_judge'])
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

test('a draft judgment maps the exact draft with its topic evidence and goal', async () => {
  const { investigation, calls } = fixture({ judge: async ({ candidates }) => ({ model: 'jev-fixture',
    answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.9, groundingProbability: 0.85, threshold: 0.8 }])) }) })
  const outcome = await investigation.tools[1].execute('t0', { suggestions: [draft] })
  const judged = calls.judge[0]
  assert.equal(judged.candidates.length, 1)
  const candidate = judged.candidates[0]
  assert.equal(candidate.id, 'd0')
  assert.equal(candidate.topicId, 'commute-anomaly')
  assert.equal(candidate.advice, draft.advice)
  assert.equal(candidate.nextStep, action.label)
  assert.equal(candidate.goal, topic().goal)
  assert.equal(candidate.generated, true)
  assert.deepEqual(candidate.evidence, topic().evidence)
  assert.deepEqual(candidate.preview.items, draft.preview.items)
  assert.equal(outcome.structuredContent.answers.d0.probability, 0.9)
  assert.equal(outcome.structuredContent.answers.d0.groundingProbability, 0.85)
})

test('a draft with unresolvable evidence is refused with model-usable feedback', async () => {
  const { investigation, calls } = fixture()
  await assert.rejects(investigation.tools[1].execute('t0', { suggestions: [{ ...draft, evidenceIds: ['e9'] }] }), /evidence/)
  assert.deepEqual(calls.judge, [])
})

test('a draft with a malformed preview is refused before judgment', async () => {
  const { investigation, calls } = fixture()
  await assert.rejects(investigation.tools[1].execute('t0', { suggestions: [{ ...draft, preview: { items: [{ label: 'a', value: 'b', tone: 'alarm' }] } }] }), /preview/)
  assert.deepEqual(calls.judge, [])
})

test('judgments stay within the bounded budget', async () => {
  const { investigation, calls } = fixture({ judge: async ({ candidates }) => ({ model: 'jev-fixture',
    answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.9, groundingProbability: 0.9, threshold: 0.8 }])) }) })
  for (let index = 0; index < 3; index++) await investigation.tools[1].execute('t0', { suggestions: [draft] })
  await assert.rejects(investigation.tools[1].execute('t0', { suggestions: [draft] }), /budget/)
  assert.equal(calls.judge.length, 3)
})

test('an Intent preview draft keeps its read-only next step', async () => {
  const input = { trigger: { kind: 'heartbeat', readingIds: [] }, context: { now: stamp },
    topics: [{ id: 'intent-ride', intentPreview: true, goal: '查看行程。', evidence: [reading('e0', 'status', 'available')] }], recent: [], maxCandidates: 8 }
  const calls = { judge: [] }
  const investigation = createProactiveInvestigationTools({ input, judge: async value => { calls.judge.push(value); return { model: 'jev-fixture', answers: { d0: { probability: 0.9, groundingProbability: 0.9, threshold: 0.8 } } } }, read: async () => ({}) })
  await investigation.tools[1].execute('t0', { suggestions: [{ topicId: 'intent-ride', advice: '查看当前行程方案。', nextStep: '选择起终点。', evidenceIds: ['e0'] }] })
  assert.equal(calls.judge[0].candidates[0].nextStep, '选择起终点。')
})
