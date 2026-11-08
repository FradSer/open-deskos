import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/recommendations/index.mjs'
import { createProactiveInvestigationTools } from '../src/proactive-investigation.mjs'
import { openuiSuggestion } from './openui-fixtures.test.mjs'

const stamp = '2026-11-06T10:00:00.000Z'
const approved = { id: 'inspect', label: 'Inspect the pending item.', tool: 'memory_update', params: { category: 'note', value: 'Inspect pending item' } }
const config = () => ({ version: 2, pollMs: 1800000, maxAgeMs: 1800000, cooldownMs: 60000,
  maxCandidates: 8, maxPush: 3, generationIntervalMs: 0, attentionCooldownMs: 0, suppressed: [], snoozed: {},
  rules: [{ actions: [approved], id: 'deliveries', goal: '及时处理需要我领取的物品。',
    observations: [{ readingId: 'thirdparty.parcels', fields: ['ready', 'count'] }], delivery: 'immediate', urgent: false }] })
const suggestion = key => openuiSuggestion({ topicId: 'deliveries', key, advice: '领取待取物品。', actionId: 'inspect', evidenceIds: ['e0'] })

function fixture(overrides = {}) {
  const generated = [], frames = []
  let raw = { suggestions: [suggestion('collect')] }
  const watch = new ProactiveWatch({ config: config(), now: () => Date.parse(stamp), canExecute: () => true,
    read: async id => ({ id, state: 'live', value: { ready: true, count: 2, measured_at: stamp } }),
    generate: async input => { generated.push(input); return raw },
    publish: f => frames.push(f), save: async () => {}, saveState: () => {},
    phrase: async ({ advice }) => advice, execute: async () => assert.fail('generation cannot execute'),
    ...overrides,
  })
  return { watch, generated, frames, raw: value => { raw = value } }
}

test('a generated candidate publishes without any judgment call', async () => {
  const f = fixture({ judge: async () => assert.fail('the Watch must not call a judgment client') })
  await f.watch.tick({ kind: 'heartbeat', readingIds: [] })
  assert.equal(f.generated.length, 1)
  const pending = f.watch.list().filter(p => p.status === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].advice, '领取待取物品。')
  assert.equal(pending[0].action?.tool, 'memory_update')
  assert.equal(Object.hasOwn(pending[0], 'judgment'), false)
  assert.equal(f.frames.at(-1).popup, true)
  await f.watch.close()
})

test('an empty generated batch publishes nothing and starts no judgment', async () => {
  const f = fixture({ judge: async () => assert.fail('no candidate means no judgment') })
  f.raw({ suggestions: [] })
  await f.watch.tick({ kind: 'heartbeat', readingIds: [] })
  assert.equal(f.watch.list().length, 0)
  assert.equal(f.frames.at(-1).popup, false)
  await f.watch.close()
})

test('a missing or failing classifier cannot disable reading or confirming proposals', async () => {
  const f = fixture()
  await f.watch.tick({ kind: 'heartbeat', readingIds: [] })
  assert.deepEqual(await f.watch.readProposals(), f.watch.list())
  await f.watch.close()
})

test('a pending proposal without a judgment record survives restart', async () => {
  const first = fixture()
  await first.watch.tick({ kind: 'heartbeat', readingIds: [] })
  const original = first.watch.list()[0]
  assert.equal(Object.hasOwn(original, 'judgment'), false)
  let saved
  const firstWithSave = fixture({ saveState: state => { saved = structuredClone(state) } })
  await firstWithSave.watch.tick({ kind: 'heartbeat', readingIds: [] })
  await firstWithSave.watch.presented([firstWithSave.watch.list()[0].id])
  const restored = fixture({ loadState: () => saved })
  const pending = restored.watch.list().filter(p => p.status === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].presented, true)
  await restored.watch.close()
  await first.watch.close()
})

test('an older checkpoint with a judgment record still loads', async () => {
  const restored = { version: 1, proposals: [{ id: '00000000-0000-4000-8000-000000000001', ruleId: 'deliveries',
    subject: 'deliveries:collect', ruleVersion: '{}', status: 'pending', advice: '旧建议。', action: null,
    confirmation: '', offered: false, presented: false, createdAt: stamp, result: '', evidence: [],
    judgment: { model: 'jev-fixture', probability: 0.9, threshold: 0.8, trigger: 'heartbeat', judgedAt: stamp } }] }
  const f = fixture({ loadState: () => structuredClone(restored) })
  assert.equal(f.watch.list().length, 1)
  await f.watch.close()
})

test('the generation session exposes only the scoped read tool', () => {
  const topic = { id: 'deliveries', goal: 'Check parcels.', actions: [approved],
    evidence: [{ id: 'e0', readingId: 'thirdparty.parcels', field: 'count', value: 2, state: 'live', measuredAt: stamp, ruleId: 'deliveries' }] }
  const tools = createProactiveInvestigationTools({ input: { topics: [topic], trigger: { kind: 'heartbeat' }, context: {}, recent: [] },
    read: async () => ({ reading: null }) })
  assert.deepEqual(tools.tools.map(t => t.name), ['proactive_read'])
})
