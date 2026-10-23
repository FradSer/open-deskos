import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { ProactiveWatch } from '../src/proactive.mjs'

const start = Date.parse('2026-10-23T10:00:00Z')

/** Replay host behavior with local fixtures. This does not evaluate model quality. */
export async function evaluateProactiveReplay({ createWatch = options => new ProactiveWatch(options) } = {}) {
  const calls = { generation: 0, judgment: 0, actions: 0 }
  const scenarios = []
  const watches = []
  function fixture({ count: initialCount = 2, config: overrides = {}, stale = false } = {}) {
    let now = start, count = initialCount, checkpoint = { version: 1, proposals: [] }
    const frames = []
    const config = { version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 4, maxPush: 1,
      attentionCooldownMs: 0, generationIntervalMs: 300000, suppressed: [], snoozed: {}, rules: [
        { id: 'parcels', goal: 'Handle pending parcels', delivery: 'immediate', urgent: false, observations: [{ readingId: 'parcels', fields: ['count'] }] },
      ], ...overrides }
    const make = () => {
      const watch = createWatch({ config, now: () => now,
        read: async id => ({ id, state: 'live', value: { count, measured_at: new Date(stale ? start - 1800001 : now).toISOString() } }),
        generate: async ({ topics }) => {
          calls.generation++
          return { suggestions: topics.filter(topic => topic.evidence[0].value > 0).map(topic => ({ topicId: topic.id, key: 'collect',
            advice: 'Check pending parcels.', nextStep: 'Open the referenced source and inspect the pending item.', evidenceIds: [topic.evidence[0].id] })) }
        },
        judge: async ({ candidates }) => {
          calls.judgment++
          return { model: 'jev-offline-fixture', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.95, groundingProbability: 0.95, threshold: 0.8 }])) }
        },
        publish: frame => frames.push(structuredClone(frame)), save: async () => {}, phrase: async ({ advice }) => advice,
        execute: async () => { calls.actions++; throw Error('Offline replay must not execute actions') },
        loadState: () => structuredClone(checkpoint), saveState: state => { checkpoint = structuredClone(state) },
      })
      watches.push(watch)
      return watch
    }
    return { make, frames, clock: value => { now = value }, count: value => { count = value } }
  }
  async function scenario(id, run) {
    const before = { ...calls }
    try { await run(); scenarios.push({ id, passed: true, calls: Object.fromEntries(Object.entries(calls).map(([key, value]) => [key, value - before[key]])) }) }
    catch (error) {
      const scalar = value => ['number', 'boolean'].includes(typeof value) || value === null
      const diagnostic = error?.code === 'ERR_ASSERTION'
        ? { code: 'ERR_ASSERTION', operator: String(error.operator).slice(0, 64),
          ...(scalar(error.actual) ? { actual: error.actual } : {}), ...(scalar(error.expected) ? { expected: error.expected } : {}) }
        : { code: 'REPLAY_FAILED' }
      scenarios.push({ id, passed: false, diagnostic, calls: Object.fromEntries(Object.entries(calls).map(([key, value]) => [key, value - before[key]])) })
    }
  }
  try {
    await scenario('normal-observation-stays-silent', async () => {
      const f = fixture({ count: 0 }), watch = f.make()
      await watch.tick()
      assert.equal(watch.list().length, 0)
      assert(!f.frames.some(frame => frame.popup))
    })
    await scenario('unchanged-observation-reuses-generation', async () => {
      const f = fixture(), watch = f.make(), before = { ...calls }
      await watch.tick()
      const first = watch.list()[0]
      assert.equal(first.offered, true)
      await watch.presented([first.id])
      f.clock(start + 1000); await watch.tick()
      assert.deepEqual(watch.list().map(p => p.id), [first.id])
      assert.equal(calls.generation - before.generation, 1)
      assert.equal(calls.judgment - before.judgment, 1)
      assert.equal(f.frames.filter(frame => frame.popup).length, 1)
    })
    await scenario('completion-survives-checkpoint-and-fact-change-creates-new-occurrence', async () => {
      const f = fixture(), watch = f.make()
      await watch.tick(); const first = watch.list()[0]
      await watch.presented([first.id]); await watch.respond(first.id, 'done')
      await watch.close()
      f.clock(start + 300001)
      const recovered = f.make(); await recovered.tick()
      assert.equal(recovered.list().filter(p => p.status === 'pending').length, 0)
      assert.equal(recovered.list().find(p => p.id === first.id).status, 'completed')
      f.count(3); await recovered.tick()
      const next = recovered.list().find(p => p.status === 'pending')
      assert(next && next.id !== first.id && next.occurrenceKey !== first.occurrenceKey)
    })
    await scenario('cleared-need-can-recur-with-the-same-value', async () => {
      const f = fixture(), watch = f.make()
      await watch.tick(); const first = watch.list()[0]
      await watch.presented([first.id]); await watch.respond(first.id, 'done')
      f.count(0); await watch.tick()
      await watch.close()
      const recovered = f.make()
      f.count(2); await recovered.tick()
      const next = recovered.list().find(p => p.status === 'pending')
      assert(next && next.id !== first.id && next.occurrenceKey !== first.occurrenceKey)
    })
    await scenario('snooze-defers-attention-until-due', async () => {
      const f = fixture(), watch = f.make()
      await watch.tick(); const first = watch.list()[0]
      await watch.presented([first.id]); await watch.respond(first.id, 'snooze')
      f.clock(start + 59000); await watch.tick()
      assert.equal(f.frames.at(-1).popup, false)
      f.clock(start + 60001); await watch.tick()
      assert.equal(f.frames.at(-1).popup, true)
      assert.equal(watch.list().find(p => p.id === first.id).status, 'pending')
    })
    await scenario('quiet-hours-defer-attention', async () => {
      const f = fixture({ config: { quietHours: { start: '09:00', end: '11:00', timeZone: 'UTC' } } }), watch = f.make()
      await watch.tick(); assert.equal(f.frames.at(-1).popup, false)
      f.clock(start + 3600001); await watch.tick()
      assert.equal(f.frames.at(-1).popup, true)
    })
    await scenario('busy-owner-defers-attention', async () => {
      const f = fixture(), watch = f.make()
      watch.setBusy(true); await watch.tick()
      assert.equal(f.frames.at(-1).popup, false)
      watch.setBusy(false)
      assert.equal(f.frames.at(-1).popup, true)
    })
    await scenario('stale-source-cannot-generate-or-offer', async () => {
      const f = fixture({ stale: true }), watch = f.make(), before = { ...calls }
      await watch.tick()
      assert.equal(watch.list().length, 0)
      assert.equal(calls.generation, before.generation)
      assert.equal(calls.judgment, before.judgment)
      assert(!f.frames.some(frame => frame.popup))
    })
  } finally { await Promise.all(watches.map(watch => watch.close())) }
  return { version: 1, mode: 'offline-fixtures', realModel: false, device: false, checkpoint: 'in-memory-restart',
    modelQuality: 'not_measured', calibration: 'not_measured', passed: scenarios.every(item => item.passed) && calls.actions === 0, scenarios, calls }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await evaluateProactiveReplay()
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (!report.passed) process.exitCode = 1
}
