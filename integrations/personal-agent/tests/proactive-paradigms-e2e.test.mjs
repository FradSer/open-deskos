// End-to-end coverage for the four information-value paradigms.
// Generation, validation, judgment, and proposal construction all run through the
// production pipeline; only the model calls are supplied by this file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/proactive.mjs'
import { createProactiveJudge } from '../src/proactive-qualification.mjs'
import { createJevJudge } from '../src/proactive-jev.mjs'
import { validateGeneratedBatch } from '../src/proactive-generation.mjs'
import { generationSystemPrompt, parseSuggestionDocument, openuiFormatCorrection, OPENUI_EXAMPLE } from '../src/openui-contract.mjs'
import {
  FULL_TREE_DOCUMENT, FULL_TREE_TYPE_COUNTS, componentNames,
  openuiBatch, openuiSuggestion, uiTypes, uiTypeCounts,
} from './openui-fixtures.test.mjs'

const stamp = '2026-11-01T09:40:00.000Z'
const action = { id: 'open', label: 'Open the plan', tool: 'memory_update', params: { category: 'note', value: 'opened' } }

// One rule per paradigm. Each rule supplies the readings that paradigm needs.
const rules = [
  {
    id: 'commute-anomaly',
    goal: 'Tell me when the commute departs from its normal duration.',
    delivery: 'immediate', urgent: false,
    observations: [{ readingId: 'commute.traffic', fields: ['minutes', 'baselineMinutes', 'delayMinutes', 'rainAt', 'rainChance'] }],
    actions: [action],
  },
  {
    id: 'commitment-guard',
    goal: 'Warn me before a calendar commitment becomes unreachable.',
    delivery: 'immediate', urgent: true,
    observations: [{ readingId: 'calendar.next', fields: ['startsAt', 'title', 'bufferMinutes', 'travelMinutes', 'shortfallMinutes'] }],
    actions: [action],
  },
  {
    id: 'commute-tradeoff',
    goal: 'Show the time and price trade-off before I choose a ride.',
    delivery: 'immediate', urgent: false,
    observations: [{ readingId: 'commute.options', fields: ['nowPrice', 'nowDelay', 'laterPrice', 'laterDelay', 'waitMinutes', 'priceDelta', 'delayDelta'] }],
    actions: [action],
  },
  {
    id: 'release-pipeline',
    goal: 'Tell me when the main branch is verified and ready to deploy.',
    delivery: 'silent', urgent: false,
    observations: [{ readingId: 'ci.main', fields: ['commit', 'passed', 'failed', 'target'] }],
    actions: [action],
  },
]

const readings = {
  'commute.traffic': { minutes: 52, baselineMinutes: 24, delayMinutes: 28, rainAt: '18:15', rainChance: 80, measured_at: stamp },
  'calendar.next': { startsAt: '14:00', title: '产品评审', bufferMinutes: 12, travelMinutes: 34, shortfallMinutes: 22, measured_at: stamp },
  'commute.options': { nowPrice: 32, nowDelay: 28, laterPrice: 58, laterDelay: 9, waitMinutes: 40, historyPrice: 34, priceDelta: 26, delayDelta: 19, measured_at: stamp },
  'ci.main': { commit: '1998604', passed: 116, failed: 0, target: 'cm5', measured_at: stamp },
}

// Each paradigm states one observed change. OpenUI owns its presentation tree.
const paradigm = {
  'commute-anomaly': { advice: '通勤比平时慢 28 分钟，建议提前出发。', heading: '通勤观察', badge: '时间增加' },
  'commitment-guard': { advice: '行程缺口 22 分钟，建议立即出发。', heading: '下一场评审', badge: '时间不足' },
  'commute-tradeoff': { advice: '等待可省 19 分钟但多付 26 元，请选定方案。', heading: '出发时机', badge: '可选方案' },
  'release-pipeline': { advice: '验证已全部通过，等待部署。', heading: '分支验证', badge: '验证通过' },
}

const config = () => ({
  version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000,
  maxCandidates: 8, maxPush: 4, generationIntervalMs: 0, attentionCooldownMs: 0,
  suppressed: [], snoozed: {}, routineDays: {}, rules: structuredClone(rules),
})

const generatedFor = topics => {
  const fieldsList = topics.map(topic => ({
    topicId: topic.id, key: 'primary', advice: paradigm[topic.id].advice,
    heading: paradigm[topic.id].heading, badge: paradigm[topic.id].badge,
    actionId: action.id, evidenceIds: topic.evidence.map(entry => entry.id),
  }))
  const batch = openuiBatch(fieldsList)
  batch.suggestions.forEach((suggestion, index) => { paradigm[topics[index].id].ui = suggestion.ui })
  return batch
}

function fixture(judge) {
  const frames = []
  const watch = new ProactiveWatch({
    config: config(), now: () => Date.parse(stamp), canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async ({ topics }) => generatedFor(topics),
    judge, publish: frame => frames.push(frame), save: async () => {}, saveState: () => {},
    execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  return { watch, frames }
}

// A judge that answers through the production question builder but replies deterministically,
// so the assertion never depends on live model availability.
const deterministic = () => createProactiveJudge({
  model: () => 'fixture/ordinary-model',
  generate: async ({ questions }) => ({
    answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [
      id, q.type === 'noul' ? { type: 'noul', noul: 0.95 } : { type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.9 },
    ])),
  }),
})

test('the generated contract declares composable primitives and host authority', () => {
  for (const name of ['Heading', 'Text', 'Badge', 'Metric', 'Stack', 'Row', 'OptionSet', 'Option', 'Divider']) {
    assert.match(generationSystemPrompt, new RegExp(`\\b${name}\\b`), name)
  }
  assert.match(generationSystemPrompt, /openui-lang/i)
  assert.match(generationSystemPrompt, /Only the host binds approved actions/)
  assert.match(generationSystemPrompt, /Every number the owner can see/i)
  assert.match(generationSystemPrompt, /Compose the card freely/i)
  assert.doesNotMatch(generationSystemPrompt, /preview\.items|boundedPreview|generationInstructions/)
  assert.ok(componentNames(OPENUI_EXAMPLE).length >= 6, 'OPENUI_EXAMPLE uses composable primitives')
})

test('advice reads as natural content and never repeats the action label', () => {
  const desktopAction = { id: action.id, label: '打开计划' }
  const topics = [{ id: 'commute-anomaly', actions: [desktopAction], evidence: [{ id: 'e0', readingId: 'r', field: 'minutes', value: 52, state: 'live', measuredAt: stamp }] }]
  const candidate = advice => openuiSuggestion({ topicId: 'commute-anomaly', key: 'primary', advice, actionId: action.id, evidenceIds: ['e0'] })
  assert.doesNotThrow(() => validateGeneratedBatch({ suggestions: [candidate('通勤比平时慢了不少。')] }, topics, 8))
  assert.throws(() => validateGeneratedBatch({ suggestions: [candidate('通勤变慢了，请打开计划。')] }, topics, 8), /action label/i)
  assert.match(generationSystemPrompt, /Advice is one short sentence/i)
  assert.match(generationSystemPrompt, /one short sentence/i)
})

test('the full OpenUI tree survives host validation without a preview projection', () => {
  const topics = [{ id: 'commute-anomaly', actions: [action], evidence: [
    { id: 'e0', readingId: 'r', field: 'minutes', value: 52, state: 'live', measuredAt: stamp },
    { id: 'e1', readingId: 'r', field: 'baselineMinutes', value: 24, state: 'live', measuredAt: stamp },
    { id: 'e2', readingId: 'r', field: 'delayMinutes', value: 28, state: 'live', measuredAt: stamp },
    { id: 'e3', readingId: 'r', field: 'startsAt', value: '14:00', state: 'live', measuredAt: stamp }] }]
  const { suggestions } = parseSuggestionDocument(FULL_TREE_DOCUMENT)
  const [result] = validateGeneratedBatch({ suggestions }, topics, 8)
  assert.deepEqual(result.ui, suggestions[0].ui)
  assert.deepEqual(uiTypeCounts(result.ui), FULL_TREE_TYPE_COUNTS, 'no emitted node is dropped')
  assert.deepEqual(JSON.parse(JSON.stringify(result.ui)), result.ui)
  assert.equal(Object.hasOwn(result, 'preview'), false)
  assert.equal(JSON.stringify(result.ui).includes('"items"'), false)
  for (const extra of ['Heading', 'Badge', 'Divider']) assert.ok(uiTypes(result.ui).includes(extra))
})

test('the host does not validate the OpenUI-owned UI shape', () => {
  const topics = [{ id: 'commute-anomaly', actions: [action], evidence: [{ id: 'e0' }] }]
  const base = openuiSuggestion({ topicId: 'commute-anomaly', key: 'primary', advice: '通勤明显慢于常态。', actionId: action.id, evidenceIds: ['e0'] })
  const alien = { type: 'ComposablePrimitive', props: { value: 'openui-owned' } }
  const [result] = validateGeneratedBatch({ suggestions: [{ ...base, ui: alien }] }, topics, 8)
  assert.deepEqual(result.ui, alien)
  assert.throws(() => parseSuggestionDocument('root = Unknown([])'), /Invalid OpenUI document/)
})

test('the OpenUI correction reuses the generated contract', () => {
  const secret = '{{SECRET_9ehkyfzm}}'
  const correction = openuiFormatCorrection(new Error(secret))
  assert.doesNotMatch(correction, /PRIVATE|one short, natural sentence|The advice and the preview must complement each other/)
  assert.ok(!correction.includes(secret))
  assert.match(correction, /root = Suggestions\(/)
  assert.ok(componentNames(correction).includes('Suggestions'))
  assert.match(generationSystemPrompt, /Only the host binds approved actions/)
})

test('an OpenUI candidate is judged by usefulness without a style gate', async () => {
  let questions
  const judge = createProactiveJudge({ model: () => 'fixture/ordinary-model', generate: async ({ questions: asked }) => {
    questions = asked
    return { answers: Object.fromEntries(Object.keys(asked).map(id => [id, { type: 'noul', noul: 0.95 }])) }
  } })
  const watch = new ProactiveWatch({
    config: { ...config(), rules: [structuredClone(rules[0])] }, now: () => Date.parse(stamp), canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async () => openuiBatch([{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤明显慢于常态。', actionId: action.id, evidenceIds: ['e0'] }]),
    judge, publish: () => {}, save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  await watch.tick()
  assert.deepEqual(Object.keys(questions), ['c0'], 'exactly one narrow usefulness question')
  assert.equal(watch.list().filter(p => p.status === 'pending').length, 1, 'a supported candidate publishes on its batch verdict')
  assert.ok(uiTypes(watch.list()[0].ui).includes('Badge'))
  await watch.close()
})

test('a full OpenUI tree publishes on the two host gates', async () => {
  let generated
  const watch = new ProactiveWatch({
    config: { ...config(), rules: [structuredClone(rules[0])] }, now: () => Date.parse(stamp), canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async ({ topics }) => {
      generated = openuiBatch([{ topicId: 'commute-anomaly', key: 'primary', advice: '通勤与常态一致。', actionId: action.id, evidenceIds: topics[0].evidence.map(entry => entry.id) }])
      return generated
    },
    judge: deterministic(), publish: () => {}, save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  await watch.tick()
  const proposals = watch.list().filter(p => p.status === 'pending')
  assert.equal(proposals.length, 1, 'each part can add information while the host gates still qualify the candidate')
  assert.deepEqual(proposals[0].ui, generated.suggestions[0].ui)
  await watch.close()
})

test('all four paradigms reach a proposal through generation, validation, and judgment', async () => {
  const f = fixture(deterministic())
  await f.watch.tick()
  const pending = f.watch.list().filter(p => p.status === 'pending')
  assert.equal(pending.length, 4, 'each paradigm creates one proposal')

  for (const proposal of pending) {
    const shape = paradigm[proposal.ruleId]
    assert.ok(proposal.ui, `${proposal.ruleId}: a proposal carries its OpenUI tree`)
    assert.deepEqual(proposal.ui, shape.ui, `${proposal.ruleId}: the full OpenUI tree survives the pipeline`)
    assert.ok(new Set(uiTypes(proposal.ui)).size >= 6, `${proposal.ruleId}: composable primitives survive`)
    assert.equal(Object.hasOwn(proposal, 'preview'), false)
    assert.equal(proposal.judgment.model, 'fixture/ordinary-model')
    assert.ok(proposal.judgment.probability >= proposal.judgment.threshold)
    assert.equal(proposal.action.tool, action.tool)
  }
  const frame = f.frames.at(-1)
  assert.equal(frame.popup, true)
  assert.equal(frame.proposals.filter(p => p.ui).length, 4)
  await f.watch.close()
})

test('the OpenUI tree survives an evidence refresh', async () => {
  const f = fixture(deterministic())
  await f.watch.tick()
  const first = f.watch.list().find(p => p.ruleId === 'commute-anomaly')
  const firstUi = structuredClone(first.ui)
  await f.watch.presented([first.id])
  await f.watch.tick()
  const again = f.watch.list().find(p => p.id === first.id)
  assert.equal(again.status, 'pending')
  assert.deepEqual(again.ui, firstUi, 'an unchanged occurrence keeps its OpenUI tree')
  await f.watch.close()
})

test('an unparsable OpenUI document fails closed without publishing', async () => {
  const frames = []
  const watch = new ProactiveWatch({
    config: { ...config(), rules: [structuredClone(rules[0])] }, now: () => Date.parse(stamp), canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async () => parseSuggestionDocument('root = Unknown([])'),
    judge: deterministic(), publish: frame => frames.push(frame), save: async () => {}, saveState: () => {},
    execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  await watch.tick()
  assert.equal(watch.list().length, 0, 'an invalid OpenUI document blocks publication')
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
  assert.equal(seen.length, 4, 'Jev judged every paradigm')
  for (const row of seen) {
    assert.ok(Number.isFinite(row.probability) && row.probability >= 0 && row.probability <= 1, `${row.ruleId}: probability`)
    assert.ok(Number.isFinite(row.groundingProbability) && row.groundingProbability >= 0 && row.groundingProbability <= 1, `${row.ruleId}: grounding`)
    assert.match(row.model, /^jev-/)
  }
  for (const proposal of f.watch.list().filter(p => p.status === 'pending')) {
    assert.ok(proposal.ui, `${proposal.ruleId}: a qualified proposal keeps its OpenUI tree`)
    assert.deepEqual(proposal.ui, paradigm[proposal.ruleId].ui)
    assert.ok(proposal.judgment.probability >= proposal.judgment.threshold)
    assert.ok(proposal.judgment.groundingProbability >= proposal.judgment.threshold)
  }
  console.log('LIVE_JEV_VERDICTS', JSON.stringify(seen.map(r => [r.ruleId, r.probability, r.groundingProbability, r.threshold])))
  await f.watch.close()

  const alone = fixture(live)
  alone.watch.config.rules = alone.watch.config.rules.filter(rule => rule.id === 'commute-anomaly')
  await alone.watch.tick()
  const soloProposal = alone.watch.list()[0]
  if (soloProposal?.status === 'pending') {
    assert.ok(soloProposal.ui, 'a solo paradigm keeps its OpenUI tree')
    assert.deepEqual(soloProposal.ui, paradigm[soloProposal.ruleId].ui)
  }
  console.log(soloProposal?.status === 'pending' ? 'LIVE_JEV_SOLO_QUALIFIED' : 'LIVE_JEV_SOLO_REJECTED',
    JSON.stringify(soloProposal?.judgment ?? null))
  await alone.watch.close()
})
