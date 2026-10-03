import { test } from 'node:test'
import { fixtureJudge } from './helpers/proactive-judge.mjs'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/proactive.mjs'
import { answerSuggestions } from '../src/proactive-answer.mjs'

const proposal = () => ({ id: 'test', status: 'pending', advice: '出门前查看天气再决定穿着。', evidence: [{ readingId: 'odk.tile.weather', field: 'temperatureC', value: 19, state: 'live', measuredAt: '2026-10-02T11:00:00Z' }], action: null })

test('current proposals produce advice and measured evidence without model capabilities', async () => {
  let reads = 0
  const answer = await answerSuggestions({ readProposals: async () => { reads++; return [proposal(), { ...proposal(), status: 'ignored', advice: '旧任务' }] } })
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
  const watch = new ProactiveWatch({ judge: fixtureJudge, config: { version: 1, rules: [{ id: 'weather', delivery: 'immediate', urgent: true, advice: '出门前查看天气。', conditions: [{ readingId: 'odk.tile.weather', field: 'temperatureC', op: 'gte', value: -100 }] }], pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, suppressed: [], snoozed: {} }, now: () => now,
    read: async () => { reads++; await gate; return { id: 'odk.tile.weather', state: 'live', value: { temperatureC: 19, asOf: new Date(now).toISOString() } } }, publish() {}, save: async () => {}, phrase: async ({ advice }) => advice, execute: async () => assert.fail('read-only request'),
  })
  const poll = watch.tick(); let settled = false
  const answer = answerSuggestions(watch).then(value => { settled = true; return value })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false)
  release(); await poll; assert.match(await answer, /19°C/); assert.equal(reads, 1)
})
