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
    observations: [{ readingId: 'commute.traffic', fields: ['minutes', 'baselineMinutes', 'delayMinutes', 'rainAt', 'rainChance'] }],
    actions: [action]
  },
  {
    id: 'commitment-guard',
    goal: 'Warn me before a calendar commitment becomes unreachable.',
    delivery: 'immediate',
    urgent: true,
    observations: [{ readingId: 'calendar.next', fields: ['startsAt', 'title', 'bufferMinutes', 'travelMinutes', 'shortfallMinutes'] }],
    actions: [action]
  },
  {
    id: 'commute-tradeoff',
    goal: 'Show the time and price trade-off before I choose a ride.',
    delivery: 'immediate',
    urgent: false,
    observations: [{ readingId: 'commute.options', fields: ['nowPrice', 'nowDelay', 'laterPrice', 'laterDelay', 'waitMinutes', 'priceDelta', 'delayDelta'] }],
    actions: [action]
  },
  {
    id: 'release-pipeline',
    goal: 'Tell me when the main branch is verified and ready to deploy.',
    // Silent: a verified branch is a standing item. It answers when asked and never interrupts.
    delivery: 'silent',
    urgent: false,
    observations: [{ readingId: 'ci.main', fields: ['commit', 'passed', 'failed', 'target'] }],
    actions: [action]
  }
]

const readings = {
  'commute.traffic': { minutes: 52, baselineMinutes: 24, delayMinutes: 28, rainAt: '18:15', rainChance: 80, measured_at: stamp },
  'calendar.next': { startsAt: '14:00', title: '产品评审', bufferMinutes: 12, travelMinutes: 34, shortfallMinutes: 22, measured_at: stamp },
  'commute.options': { nowPrice: 32, nowDelay: 28, laterPrice: 58, laterDelay: 9, waitMinutes: 40, historyPrice: 34, priceDelta: 26, delayDelta: 19, measured_at: stamp },
  'ci.main': { commit: '1998604', passed: 116, failed: 0, target: 'cm5', measured_at: stamp }
}

// Each paradigm's preview shape. Values are copied from the cited readings.
const paradigm = {
  'commute-anomaly': {
    advice: '通勤比平时慢 28 分钟，建议提前出发。',
    summary: '通勤时长与常态对比',
    items: [
      { label: '预计耗时', value: '52 分钟', tone: 'warn' },
      { label: '基准耗时', value: '24 分钟' },
      { label: '多出的时间', value: '28 分钟', tone: 'warn' }
    ]
  },
  'commitment-guard': {
    advice: '行程缺口 22 分钟，建议立即出发。',
    summary: '下一场评审的时间缺口',
    items: [
      { label: '剩余缓冲', value: '12 分钟', tone: 'warn' },
      { label: '通勤耗时', value: '34 分钟' }
    ]
  },
  'commute-tradeoff': {
    advice: '等待可省 19 分钟但多付 26 元，请选定方案。',
    summary: '同一路线的两个出发时机',
    items: [
      { label: '现在出发', value: '32 元', tone: 'warn' },
      { label: '等 40 分钟', value: '58 元' },
      { label: '现在延误', value: '28 分钟' }
    ]
  },
  'release-pipeline': {
    advice: '验证已全部通过，等待部署。',
    summary: 'main 分支验证结果',
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
  assert.match(generationInstructions, /preview\.items is 1-3/)
  assert.match(generationInstructions, /Every value is copied from a cited observation/)
  assert.match(generationInstructions, /Prefer a difference that the observations already measure/)
  assert.match(generationInstructions, /The advice and the preview must complement each other/)
  assert.match(generationInstructions, /equal values for genuinely different facts are valid/)
  assert.match(generationInstructions, /Use proactive_judge at most once/i)
  assert.doesNotMatch(generationInstructions, /complementarityProbability/)
  assert.match(generationInstructions, /host independently judges every returned candidate/i)
  assert.match(generationInstructions, /"warn"/)
  assert.match(generationInstructions, /"good"/)
  assert.match(generationInstructions, /neutral/)
})

test('advice reads as natural content and never repeats the action label', () => {
  const desktopAction = { id: action.id, label: '打开计划' }
  const topics = [{ id: 'commute-anomaly', actions: [desktopAction], evidence: [{ id: 'e0', readingId: 'r', field: 'minutes', value: 52, state: 'live', measuredAt: stamp }] }]
  const base = { topicId: 'commute-anomaly', key: 'primary', actionId: action.id, evidenceIds: ['e0'] }
  // Natural: states what changed, leaves the action to the button.
  assert.doesNotThrow(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤比平时慢了不少。' }] }, topics, 8))
  // The action label is already the button text; repeating it in advice is redundant.
  assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤变慢了，请打开计划。' }] }, topics, 8), /action label/i)
  // The instructions must not ask the model to write the action into advice,
  // and must ask for spoken language and plain labels instead of report copy.
  assert.doesNotMatch(generationInstructions, /stating the meaning and the action/)
  assert.match(generationInstructions, /do not (?:restate|repeat) the action label/i)
  assert.match(generationInstructions, /plain spoken language/)
  assert.match(generationInstructions, /without bracketed units/)
})

test('the preview contract carries only the readings behind the advice', () => {
  assert.match(generationInstructions, /at most three/i)
  assert.match(generationInstructions, /Do not list every observation/i)
  assert.match(generationInstructions, /1-3 \{label,value,tone\}/)
  const topics = [{ id: 't', actions: [{ id: 'a', label: 'Open' }], evidence: [{ id: 'e0', readingId: 'r', field: 'x', value: 1 }] }]
  const base = { topicId: 't', key: 'k', advice: '路线比平时慢。', actionId: 'a', evidenceIds: ['e0'] }
  const four = { items: [1, 2, 3, 4].map(n => ({ label: `读数${n}`, value: String(n) })) }
  assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, preview: four }] }, topics, 8), /preview/i)
  const three = { items: four.items.slice(0, 3) }
  assert.equal(validateGeneratedBatch({ suggestions: [{ ...base, preview: three }] }, topics, 8).length, 1)
})

test('preview instructions drop report headings and redundant labels', () => {
  assert.match(generationInstructions, /Omit preview\.summary when the item labels already say what the readings are/i)
  assert.match(generationInstructions, /no report heading, no restatement of advice/i)
  assert.match(generationInstructions, /without redundant qualifiers/i)
})

test('generation instructions forbid consequences the observations do not state', () => {
  assert.match(generationInstructions, /Do not add a consequence, risk, likelihood, outcome/i)
  assert.match(generationInstructions, /State only the observed change/i)
  assert.match(generationInstructions, /second clause that restates the same fact/i)
})

test('generation instructions keep every topic and forbid in-process shortlisting', () => {
  assert.match(generationInstructions, /return one suggestion for each topic/i)
  assert.match(generationInstructions, /Do not pick a single best topic or drop a topic/i)
  assert.match(generationInstructions, /Use proactive_judge at most once/i)
  assert.doesNotMatch(generationInstructions, /revise or drop weak ones/i)
})

test('the validator accepts each paradigm preview and rejects a fabricated shape', () => {
  const topics = [{ id: 'commute-anomaly', actions: [action], evidence: [{ id: 'e0', readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: stamp }] }]
  const base = { topicId: 'commute-anomaly', key: 'primary', actionId: action.id, evidenceIds: ['e0'] }
  const shape = paradigm['commute-anomaly']
  const ok = validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤明显慢于常态。', preview: { summary: shape.summary, items: shape.items } }] }, topics, 8)
  assert.deepEqual(ok[0].preview.items[0], { label: '预计耗时', value: '52 分钟', tone: 'warn' })
  for (const preview of [
    { items: [] },
    { items: [1, 2, 3, 4].map(n => ({ label: `读数${n}`, value: String(n) })) },
    { items: Array.from({ length: 7 }, () => ({ label: 'a', value: 'b' })) },
    { items: [{ label: 'a', value: 'b', tone: 'alarm' }] },
    { items: [{ label: '', value: 'b' }] },
    { summary: 'x'.repeat(121), items: [{ label: 'a', value: 'b' }] },
    { items: [{ label: 'a', value: 'b' }], extra: 1 }
  ]) {
    assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤明显慢于常态。', preview }] }, topics, 8), /preview/, JSON.stringify(preview).slice(0, 60))
  }
})

test('numeric preview values are observations too and normalize to strings', () => {
  const topics = [{ id: 'commute-anomaly', actions: [action], evidence: [{ id: 'e0', readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: stamp }] }]
  const base = { topicId: 'commute-anomaly', key: 'primary', actionId: action.id, evidenceIds: ['e0'] }
  // The model sometimes copies the observed number instead of a string; both are the same observation.
  const ok = validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤明显慢于常态。', preview: { items: [{ label: '预计耗时（分钟）', value: 52, tone: 'warn' }] } }] }, topics, 8)
  assert.equal(ok[0].preview.items[0].value, '52', 'a numeric observation normalizes to its string form')
  // Non-finite numbers stay rejected.
  assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤明显慢于常态。', preview: { items: [{ label: 'a', value: Number.NaN }] } }] }, topics, 8), /preview/)
})

test('equal values for distinct facts remain valid when each part adds information', () => {
  const topics = [{ id: 'commute-anomaly', actions: [action], evidence: [{ id: 'e0', readingId: 'commute.traffic', field: 'minutes', value: 24, state: 'live', measuredAt: stamp }, { id: 'e1', readingId: 'commute.traffic', field: 'baselineMinutes', value: 24, state: 'live', measuredAt: stamp }] }]
  const base = { topicId: 'commute-anomaly', key: 'primary', actionId: action.id, evidenceIds: ['e0', 'e1'] }
  // Two different facts can carry equal values; the validator must not reject them.
  assert.doesNotThrow(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '通勤与常态一致。',
    preview: { items: [{ label: '当前耗时', value: '24 分钟' }, { label: '基准耗时', value: '24 分钟' }] } }] }, topics, 8))
  // A number shared by unrelated facts is not a repetition either.
  assert.doesNotThrow(() => validateGeneratedBatch({ suggestions: [{ ...base, advice: '价格差 5 元，请选定方案。',
    preview: { items: [{ label: '等待时长', value: '5 分钟' }] } }] }, topics, 8))
})

test('a preview candidate is judged by usefulness and support without a style gate', async () => {
  let questions
  const judge = createJevJudge({ request: async ({ questions: asked }) => {
    questions = asked
    return { model: 'jev-fixture', answers: Object.fromEntries(Object.keys(asked).map(id => [id, { type: 'noul', noul: id.endsWith('_unsupported') ? 0.05 : 0.95 }])) }
  } })
  const watch = new ProactiveWatch({
    config: { ...config(), rules: [structuredClone(rules[0])] },
    now: () => Date.parse(stamp),
    canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async () => ({ suggestions: [{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤明显慢于常态。', actionId: action.id,
      preview: { items: [{ label: '预计耗时', value: '52 分钟', tone: 'warn' }, { label: '基准耗时', value: '24 分钟' }] }, evidenceIds: ['e0'] }] }),
    judge, publish: () => {},
    save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  await watch.tick()
  assert.deepEqual(Object.keys(questions).sort(), ['c0', 'c0_grounded', 'c0_unsupported'], 'exactly three typed questions')
  assert.equal(watch.list().filter(p => p.status === 'pending').length, 1, 'a supported candidate publishes on its batch verdict')
  await watch.close()
})

test('equal values for distinct facts publish on the two host gates', async () => {
  const frames = []
  const watch = new ProactiveWatch({
    config: { ...config(), rules: [structuredClone(rules[0])] },
    now: () => Date.parse(stamp),
    canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async ({ topics }) => ({ suggestions: [{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤与常态一致。', actionId: action.id,
      preview: { items: [{ label: '当前耗时', value: '24 分钟' }, { label: '基准耗时', value: '24 分钟' }] }, evidenceIds: topics[0].evidence.map(entry => entry.id) }] }),
    judge: createJevJudge({ request: async ({ questions }) => ({ model: 'jev-fixture',
      answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: id.endsWith('_unsupported') ? 0.05 : 0.95 }])) }) }),
    publish: frame => frames.push(frame),
    save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  await watch.tick()
  const proposals = watch.list().filter(p => p.status === 'pending')
  assert.equal(proposals.length, 1, 'equal values for distinct facts publish when each part adds information')
  await watch.close()
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
    generate: async () => ({ suggestions: [{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤明显慢于常态。', actionId: action.id, preview: { items: [{ label: 'a', value: 'b', tone: 'alarm' }] }, evidenceIds: ['e0'] }] }),
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

  // Judging four candidates at once measurably lowers grounding, so also judge the strongest
  // paradigm alone. This is the claim that matters: the shape can clear the bar by itself.
  const alone = fixture(live)
  alone.watch.config.rules = alone.watch.config.rules.filter(rule => rule.id === 'commute-anomaly')
  await alone.watch.tick()
  const soloProposal = alone.watch.list()[0]
  // Qualifying is a quality result, not a contract: live Jev varies near the 0.8 bar.
  // What must hold is that a qualified proposal carries its preview.
  if (soloProposal?.status === 'pending') {
    assert.ok(soloProposal.preview, 'a solo paradigm keeps its preview')
  }
  console.log(soloProposal?.status === 'pending' ? 'LIVE_JEV_SOLO_QUALIFIED' : 'LIVE_JEV_SOLO_REJECTED',
    JSON.stringify(soloProposal?.judgment ?? null))
  await alone.watch.close()
})