import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/recommendations/index.mjs'
import { answerSuggestions } from '../src/recommendations/index.mjs'
import { createProposalTools } from '../src/proactive-tools.mjs'

const proposal = () => ({ id: 'test', status: 'pending', advice: '出门前查看天气再决定穿着。', nextStep: '打开天气，查看最新预报。', reason: 'Legacy reason must remain hidden.', evidence: [{ readingId: 'odk.tile.weather', field: 'temperatureC', value: 19, state: 'live', measuredAt: '2026-10-02T11:00:00Z' }], action: null })

test('current proposals produce advice and measured evidence without model capabilities', async () => {
  let reads = 0
  const answer = await answerSuggestions({ readProposals: async () => { reads++; return [proposal(), { ...proposal(), status: 'ignored', advice: '旧任务' }] } })
  assert.match(answer, /下一步：打开天气，查看最新预报/); assert.doesNotMatch(answer, /Legacy reason|建议原因/);
  assert.equal(reads, 1); assert.match(answer, /出门前查看天气再决定穿着/); assert.match(answer, /19°C/); assert.match(answer, /2026-10-02T11:00:00Z/); assert.doesNotMatch(answer, /旧任务|我能|可用工具/)
})

test('no pending suggestion and unavailable source are different from generic advice', async () => {
  assert.match(await answerSuggestions({ readProposals: async () => [] }), /没有.*建议/)
  assert.match(await answerSuggestions(undefined), /未启用/)
  assert.match(await answerSuggestions({ readProposals: async () => { throw Error('private error') } }), /无法读取/)
})

test('suggestion refresh joins an active poll and waits for new readings', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let reads = 0
  const now = Date.parse('2026-10-02T11:00:00Z')
  const watch = new ProactiveWatch({ config: { version: 1, rules: [{ id: 'weather', delivery: 'immediate', urgent: true, advice: '出门前查看天气。', conditions: [{ readingId: 'odk.tile.weather', field: 'temperatureC', op: 'gte', value: -100 }] }], pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, suppressed: [], snoozed: {} }, now: () => now,
    read: async () => { reads++; await gate; return { id: 'odk.tile.weather', state: 'live', value: { temperatureC: 19, asOf: new Date(now).toISOString() } } }, publish() {}, save: async () => {}, phrase: async ({ advice }) => advice, execute: async () => assert.fail('read-only request'),
  })
  const poll = watch.tick(); let settled = false
  const answer = answerSuggestions(watch).then(value => { settled = true; return value })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false)
  release(); await poll; assert.match(await answer, /19°C/); assert.equal(reads, 1)
})


test('generic desk Intent proposals stay local while ordinary and synthetic Intent proposals remain readable', async () => {
  const intentId = '9558d0ec-fbbf-47a8-8850-39dc7500e6a1'
  const privateValue = 'fixture-widget-value'
  const generic = { ...proposal(), id: '4d6429bf-5d96-4c83-8334-eb1ad02721d6', ruleId: `intent-${intentId}`,
    advice: 'Fixture local card', evidence: [{ ...proposal().evidence[0], value: privateValue }], offered: true, presented: true }
  const ride = { ...proposal(), id: '0f34db31-3ee4-46b3-ad52-40c9772aa5fb', ruleId: `intent-${intentId}`,
    advice: 'Ride preview', evidence: [{ ...proposal().evidence[0], readingId: `intent.${intentId}`, field: 'wish', value: 'Preview a trip' }] }
  const ordinary = { ...proposal(), ruleId: 'intent-weather', offered: true, presented: true }
  const proposals = [generic, ride, ordinary]
  const watch = {
    list: () => proposals,
    readProposals: async () => proposals,
    now: () => 0,
    respond: async id => { assert.equal(id, ordinary.id); return ordinary },
  }
  const answer = await answerSuggestions(watch)
  assert.doesNotMatch(answer, /Fixture local card|fixture-widget-value/)
  assert.match(answer, /Ride preview/)
  assert.match(answer, /19°C/)
  const tools = createProposalTools(() => watch, () => 'done')
  const list = await tools.find(tool => tool.name === 'personal_agent_proposals').execute('list', {})
  assert.deepEqual(list.structuredContent.proposals, [ride, ordinary])
  const respond = tools.find(tool => tool.name === 'personal_agent_proposal_respond')
  await assert.rejects(respond.execute('respond', { id: generic.id, decision: 'done' }), /conversation list/)
  assert.deepEqual((await respond.execute('respond', { id: ordinary.id, decision: 'done' })).structuredContent, ordinary)
})
