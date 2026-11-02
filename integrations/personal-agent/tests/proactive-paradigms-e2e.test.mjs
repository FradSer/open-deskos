// End-to-end coverage for the four information-value paradigms.
// Generation, validation, judgment, and proposal construction all run through the
// production pipeline; only the model calls are supplied by this file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/proactive.mjs'
import { createJevJudge } from '../src/proactive-jev.mjs'
import { generationInstructions, validateGeneratedBatch } from '../src/proactive-generation.mjs'

const stamp = '2026-11-01T09:40:00.000Z'
const action = { id: 'open', label: 'Open the plan', tool: 'memory_update', params: { category: 'note', value: 'opened' } }

// One rule per paradigm. Each rule supplies the readings that paradigm needs.
const rules = [
  {
    id: 'commute-anomaly',
    goal: 'Tell me when the commute departs from its normal duration.',
    delivery: 'immediate',
    urgent: false,
    observations: [{ readingId: 'commute.traffic', fields: ['minutes', 'delayMinutes', 'rainAt', 'rainChance'] }],
    actions: [action]
  },
  {
    id: 'commitment-guard',
    goal: 'Warn me before a calendar commitment becomes unreachable.',
    delivery: 'immediate',
    urgent: true,
    observations: [{ readingId: 'calendar.next', fields: ['startsAt', 'title', 'bufferMinutes', 'travelMinutes'] }],
    actions: [action]
  },
  {
    id: 'commute-tradeoff',
    goal: 'Show the time and price trade-off before I choose a ride.',
    delivery: 'immediate',
    urgent: false,
    observations: [{ readingId: 'commute.options', fields: ['nowPrice', 'nowDelay', 'laterPrice', 'laterDelay', 'waitMinutes', 'historyPrice'] }],
    actions: [action]
  },
  {
    id: 'release-pipeline',
    goal: 'Tell me when the main branch is verified and ready to deploy.',
    delivery: 'immediate',
    urgent: false,
    observations: [{ readingId: 'ci.main', fields: ['commit', 'passed', 'failed', 'target'] }],
    actions: [action]
  }
]

const readings = {
  'commute.traffic': { minutes: 52, delayMinutes: 28, rainAt: '18:15', rainChance: 80, measured_at: stamp },
  'calendar.next': { startsAt: '14:00', title: '产品评审', bufferMinutes: 12, travelMinutes: 34, measured_at: stamp },
  'commute.options': { nowPrice: 32, nowDelay: 28, laterPrice: 58, laterDelay: 9, waitMinutes: 40, historyPrice: 34, measured_at: stamp },
  'ci.main': { commit: '1998604', passed: 116, failed: 0, target: 'cm5', measured_at: stamp }
}

// Each paradigm's preview shape. Values are copied from the cited readings.
const paradigm = {
  'commute-anomaly': {
    advice: '通勤耗时 52 分钟，延迟 28 分钟。',
    summary: '理想中心（公司） → 静安里（家）',
    items: [
      { label: '预计耗时', value: '52 分钟', tone: 'warn' },
      { label: '较平时', value: '多 28 分钟', tone: 'warn' },
      { label: '中雨到达', value: '18:15' },
      { label: '降水概率', value: '80%' }
    ]
  },
  'commitment-guard': {
    advice: '产品评审 14:00 开始；通勤 34 分钟，缓冲 12 分钟。',
    summary: '14:00 产品评审',
    items: [
      { label: '剩余缓冲', value: '12 分钟', tone: 'warn' },
      { label: '通勤耗时', value: '34 分钟' }
    ]
  },
  'commute-tradeoff': {
    advice: '现在走 32 元、延迟 28 分钟；等 40 分钟走 58 元、延迟 9 分钟。',
    summary: '现在 32 元 / 等 40 分钟 58 元',
    items: [
      { label: '现在出发', value: '32 元 · 延迟 28 分钟', tone: 'warn' },
      { label: '等 40 分钟', value: '58 元 · 延迟 9 分钟' },
      { label: '历史均价', value: '34 元' }
    ]
  },
  'release-pipeline': {
    advice: 'main 分支 116 项通过、0 项失败，目标机 cm5。',
    summary: 'main · Commit 1998604',
    items: [
      { label: '自动化验证', value: '116 通过', tone: 'good' },
      { label: '失败', value: '0' },
      { label: '目标机', value: 'cm5' }
    ]
  }
}

const config = () => ({
  version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000,
  maxCandidates: 8, maxPush: 4, generationIntervalMs: 0, attentionCooldownMs: 0,
  suppressed: [], snoozed: {}, routineDays: {}, rules: structuredClone(rules)
})

function fixture(judge) {
  const frames = []
  const watch = new ProactiveWatch({
    config: config(),
    now: () => Date.parse(stamp),
    canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async ({ topics }) => ({
      suggestions: topics.map(topic => {
        const shape = paradigm[topic.id]
        return {
          topicId: topic.id,
          key: 'primary',
          advice: shape.advice,
          actionId: action.id,
          preview: { ...(shape.summary ? { summary: shape.summary } : {}), items: shape.items },
          evidenceIds: topic.evidence.map(e => e.id)
        }
      })
    }),
    judge,
    publish: frame => frames.push(frame),
    save: async () => {},
    saveState: () => {},
    execute: async () => 'done',
    phrase: async ({ advice }) => advice
  })
  return { watch, frames }
}

// A judge that answers through the production question builder but replies deterministically,
// so the assertion never depends on live model availability.
const deterministic = () => createJevJudge({
  request: async ({ questions }) => ({
    model: 'jev-fixture',
    answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [
      // `_unsupported` asks whether the text invents a fact, so a clean candidate answers low.
      id, q.type === 'noul' ? { type: 'noul', noul: /_unsupported$/.test(id) ? 0.05 : 0.95 } : { type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.9 }
    ]))
  })
})

test('the generator instructions teach the preview shape', () => {
  assert.match(generationInstructions, /preview object/)
  assert.match(generationInstructions, /preview\.items is 1-6/)
  assert.match(generationInstructions, /Copy every value from a cited observation/)
  assert.match(generationInstructions, /"warn"/)
  assert.match(generationInstructions, /"good"/)
})

test('the validator accepts each paradigm preview and rejects a fabricated shape', () => {
  const topics = [{ id: 'commute-anomaly', actions: [action], evidence: [{ id: 'e0', readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: stamp }] }]
  const base = { topicId: 'commute-anomaly', key: 'primary', actionId: action.id, evidenceIds: ['e0'] }
  const shape = paradigm['commute-anomaly']
  const ok = validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤耗时 52 分钟。', preview: { summary: shape.summary, items: shape.items } }] }, topics, 8)
  assert.deepEqual(ok[0].preview.items[0], { label: '预计耗时', value: '52 分钟', tone: 'warn' })
  for (const preview of [
    { items: [] },
    { items: Array.from({ length: 7 }, () => ({ label: 'a', value: 'b' })) },
    { items: [{ label: 'a', value: 'b', tone: 'alarm' }] },
    { items: [{ label: '', value: 'b' }] },
    { summary: 'x'.repeat(121), items: [{ label: 'a', value: 'b' }] },
    { items: [{ label: 'a', value: 'b' }], extra: 1 }
  ]) {
    assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤耗时 52 分钟。', preview }] }, topics, 8), /preview/, JSON.stringify(preview).slice(0, 60))
  }
})

test('all four paradigms reach a proposal through generation, validation, and judgment', async () => {
  const f = fixture(deterministic())
  await f.watch.tick()
  const pending = f.watch.list().filter(p => p.status === 'pending')
  assert.equal(pending.length, 4, 'each paradigm creates one proposal')

  for (const proposal of pending) {
    const shape = paradigm[proposal.ruleId]
    assert.ok(proposal.preview, `${proposal.ruleId}: a proposal carries its preview`)
    assert.equal(proposal.preview.summary, shape.summary, `${proposal.ruleId}: summary survives the pipeline`)
    assert.deepEqual(proposal.preview.items, shape.items, `${proposal.ruleId}: items survive the pipeline`)
    assert.deepEqual(proposal.judgment.model, 'jev-fixture')
    assert.ok(proposal.judgment.probability >= proposal.judgment.threshold)
    assert.equal(proposal.action.tool, action.tool)
  }
  // The pushed frame is what the renderer receives.
  const frame = f.frames.at(-1)
  assert.equal(frame.popup, true)
  assert.equal(frame.proposals.filter(p => p.preview).length, 4)
  await f.watch.close()
})

test('a preview survives an evidence refresh without changing its values', async () => {
  const f = fixture(deterministic())
  await f.watch.tick()
  const first = f.watch.list().find(p => p.ruleId === 'commute-anomaly')
  await f.watch.presented([first.id])
  await f.watch.tick()
  const again = f.watch.list().find(p => p.id === first.id)
  assert.equal(again.status, 'pending')
  assert.deepEqual(again.preview.items, first.preview.items, 'an unchanged occurrence keeps its preview')
  await f.watch.close()
})

test('a malformed preview cannot publish a proposal', async () => {
  const frames = []
  const watch = new ProactiveWatch({
    config: { ...config(), rules: [structuredClone(rules[0])] },
    now: () => Date.parse(stamp),
    canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async () => ({ suggestions: [{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤耗时 52 分钟。', actionId: action.id, preview: { items: [{ label: 'a', value: 'b', tone: 'alarm' }] }, evidenceIds: ['e0'] }] }),
    judge: deterministic(),
    publish: frame => frames.push(frame),
    save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice
  })
  await watch.tick()
  assert.equal(watch.list().length, 0, 'an invalid preview blocks publication')
  assert.match(frames.at(-1).error, /生成|generation/i)
  await watch.close()
})

// Opt in with ODK_LIVE_JEV_E2E=1 to exercise the real Jev service instead of the
// deterministic responder. It spends real classifier calls and its verdicts vary.
test('live Jev judges the four paradigms', { skip: process.env.ODK_LIVE_JEV_E2E !== '1', timeout: 180000 }, async () => {
  const seen = []
  const live = createJevJudge({ env: process.env })
  const recording = async input => {
    const result = await live(input)
    for (const candidate of input.candidates) seen.push({ ruleId: candidate.ruleId, ...result.answers[candidate.id], model: result.model })
    return result
  }
  const f = fixture(recording)
  await f.watch.tick()
  const all = f.watch.list()
  // The judge is the gate, so the assertion is that it ran on every paradigm and returned
  // a valid probability. Whether each one clears the 0.8 bar is a quality result to report.
  assert.equal(seen.length, 4, 'Jev judged every paradigm')
  for (const row of seen) {
    assert.ok(Number.isFinite(row.probability) && row.probability >= 0 && row.probability <= 1, `${row.ruleId}: probability`)
    assert.ok(Number.isFinite(row.groundingProbability) && row.groundingProbability >= 0 && row.groundingProbability <= 1, `${row.ruleId}: grounding`)
    assert.match(row.model, /^jev-/)
  }
  for (const proposal of all.filter(p => p.status === 'pending')) {
    assert.ok(proposal.preview, `${proposal.ruleId}: a qualified proposal keeps its preview`)
    assert.ok(proposal.judgment.probability >= proposal.judgment.threshold)
    assert.ok(proposal.judgment.groundingProbability >= proposal.judgment.threshold)
  }
  console.log('LIVE_JEV_VERDICTS', JSON.stringify(seen.map(r => [r.ruleId, r.probability, r.groundingProbability, r.threshold])))
  await f.watch.close()
})