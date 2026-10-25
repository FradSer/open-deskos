import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch } from '../src/proactive.mjs'
import { PersonalAgentService } from '../src/service.mjs'

const start = Date.parse('2026-10-23T10:00:00Z')
const answer = candidates => ({ model: 'jev-fixture', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.95, groundingProbability: 0.95, threshold: 0.8 }])) })
function fixture(options = {}) {
  let now = start, count = 2, raw, saved
  const frames = [], requests = [], actions = []
  const config = { version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 8, maxPush: 1,
    generationIntervalMs: 0, attentionCooldownMs: 0, suppressed: [], snoozed: {}, rules: [{ id: 'parcels', goal: 'Handle pending parcels', delivery: 'immediate', urgent: false, observations: [{ readingId: 'parcels', fields: ['count'] }] }], ...options.config }
  const watch = new ProactiveWatch({ config, now: () => now,
    read: async id => ({ id, state: 'live', value: { count, measured_at: new Date(now).toISOString() } }),
    generate: async input => { requests.push(input); return raw ?? { suggestions: input.topics.flatMap(topic => ['collect', 'check'].map(key => ({ topicId: topic.id, key, advice: `${key} ${topic.id}`, reason: 'Pending parcels need attention.', evidenceIds: [topic.evidence[0].id] }))) } },
    judge: async ({ candidates }) => answer(candidates), publish: frame => frames.push(frame), save: async () => {}, saveState: state => { saved = structuredClone(state) },
    execute: async (...args) => { actions.push(args); return 'executed' }, phrase: async ({ advice }) => advice, ...options.dependencies })
  return { watch, frames, requests, actions, saved: () => saved, clock: value => { now = value }, count: value => { count = value }, raw: value => { raw = value } }
}

test('presentation receipts recheck freshness before acknowledging routine recommendations', async () => {
  for (const { ages, elapsed } of [
    { ages: [0], elapsed: 1001 },
    { ages: [500, 0], elapsed: 501 },
    { ages: [0], elapsed: 1000 }
  ]) {
    let now = start, saved
    const writes = []
    const rules = ages.map((_, i) => ({ id: `routine-${i}`, delivery: 'routine', at: '09:00', urgent: false, advice: 'Check the pending reading.',
      conditions: [{ readingId: `source-${i}`, field: 'count', measuredAtField: 'measuredAt', op: 'gte', value: 1 }] }))
    const watch = new ProactiveWatch({
      config: { version: 1, pollMs: 60000, maxAgeMs: 1000, cooldownMs: 60000, suppressed: [], snoozed: {}, rules },
      now: () => now,
      read: async id => ({ id, state: 'live', value: { count: 1, measuredAt: new Date(start - ages[Number(id.split('-')[1])]).toISOString() } }),
      judge: async ({ candidates }) => answer(candidates), phrase: async ({ advice }) => advice,
      publish: () => {}, save: async config => { writes.push(structuredClone(config)) },
      saveState: state => { saved = structuredClone(state) }, execute: async () => { throw Error('Presentation must not execute an action') }
    })
    await watch.tick()
    const offered = structuredClone(watch.proposals)
    assert.equal(offered.length, ages.length)
    assert.ok(offered.every(p => p.status === 'pending' && p.offered && !p.presented))
    now += elapsed
    await watch.presented(offered.map(p => p.id))
    const freshRuleIds = []
    for (const [i, original] of offered.entries()) {
      const fresh = ages[i] + elapsed <= 1000
      const proposal = watch.proposals.find(p => p.id === original.id)
      assert.equal(proposal.status, fresh ? 'pending' : 'expired')
      assert.equal(proposal.presented, fresh)
      assert.equal(saved.proposals.find(p => p.id === original.id).presented, fresh)
      if (fresh) freshRuleIds.push(original.ruleId)
    }
    assert.deepEqual(Object.keys(watch.config.routineDays).sort(), freshRuleIds.sort())
    assert.equal(writes.length, freshRuleIds.length ? 1 : 0)
    if (writes.length) assert.deepEqual(Object.keys(writes[0].routineDays).sort(), freshRuleIds)
  }
})

test('presentation budget retains all needs and offers only its visible subset', async () => {
  const f = fixture(); await f.watch.tick()
  const pending = f.watch.list().filter(p => p.status === 'pending')
  assert.equal(pending.length, 2)
  assert.equal(pending.filter(p => p.offered).length, 1)
  assert.equal(f.frames.at(-1).proposals.filter(p => p.offered).length, 1)
  assert.ok(pending.every(p => p.reason && p.needKey && p.observationKey && p.occurrenceKey))
})

test('ordinary busy release retains quiet hours and attention cooldown', async () => {
  const quiet = fixture({ config: { quietHours: { start: '09:00', end: '11:00', timeZone: 'UTC' } } })
  quiet.watch.setBusy(true); await quiet.watch.tick(); quiet.watch.setBusy(false)
  assert.equal(quiet.frames.at(-1).popup, false)
  quiet.watch.interact(true)
  assert.equal(quiet.frames.at(-1).popup, true, 'explicit inspection can reveal current suggestions')
  const cooled = fixture({ config: { attentionCooldownMs: 60000 }, dependencies: { generate: async ({ topics }) => ({ suggestions: topics.map(topic => ({ topicId: topic.id, key: 'collect', advice: 'Check parcels.', reason: 'Observed count.', evidenceIds: [topic.evidence[0].id] })) }) } })
  await cooled.watch.tick(); const first = cooled.watch.list().find(p => p.offered)
  await cooled.watch.presented([first.id])
  cooled.watch.setBusy(true); cooled.clock(start + 1000); cooled.count(3); await cooled.watch.tick()
  cooled.watch.setBusy(false)
  assert.equal(cooled.frames.at(-1).popup, false)
  cooled.clock(start + 60001); await cooled.watch.tick()
  assert.equal(cooled.frames.at(-1).popup, true)
})

test('changed facts create a new occurrence while timestamps retain acknowledgement', async () => {
  const f = fixture(); await f.watch.tick()
  const first = f.watch.list().find(p => p.offered); await f.watch.presented([first.id])
  f.clock(start + 1000); await f.watch.tick()
  assert.equal(f.watch.list().find(p => p.needKey === first.needKey && p.status === 'pending').id, first.id)
  f.count(3); await f.watch.tick()
  const next = f.watch.list().find(p => p.needKey === first.needKey && p.status === 'pending')
  assert.notEqual(next.id, first.id)
  assert.notEqual(next.occurrenceKey, first.occurrenceKey)
  assert.equal(f.watch.list().find(p => p.id === first.id).status, 'expired')
})

test('handled occurrence stays suppressed after regeneration and restart without muting its topic', async () => {
  for (const decision of ['done', 'ignore', 'irrelevant', 'incorrect']) {
    const f = fixture(); await f.watch.tick(); const first = f.watch.list().find(p => p.offered)
    await f.watch.presented([first.id]); await f.watch.respond(first.id, decision)
    await f.watch.tick()
    assert.equal(f.watch.list().filter(p => p.status === 'pending').length, 1)
    assert.deepEqual(f.watch.config.snoozed, {})
    assert.equal(f.actions.length, 0)
    const next = fixture({ dependencies: { loadState: f.saved } }); await next.watch.tick()
    assert.equal(next.watch.list().filter(p => p.status === 'pending').length, 1)
    f.count(3); await f.watch.tick()
    assert.equal(f.watch.list().filter(p => p.status === 'pending').length, 2)
  }
})

test('candidate snooze persists and useful feedback never executes or completes', async () => {
  const f = fixture(); await f.watch.tick(); const first = f.watch.list().find(p => p.offered)
  await f.watch.presented([first.id]); await f.watch.respond(first.id, 'snooze')
  let p = f.watch.list().find(p => p.id === first.id)
  assert.equal(p.status, 'pending'); assert.equal(p.snoozedUntil, start + 60000)
  assert.deepEqual(f.watch.config.snoozed, {})
  await f.watch.tick(); assert.equal(f.watch.list().filter(p => p.status === 'pending').length, 2)
  f.clock(start + 60001); f.watch.interact(true)
  assert.equal(f.frames.at(-1).proposals.find(p => p.id === first.id).offered, true)
  await f.watch.respond(first.id, 'useful')
  p = f.watch.list().find(p => p.id === first.id)
  assert.equal(p.feedback, 'useful'); assert.equal(p.status, 'pending'); assert.equal(f.actions.length, 0)
})

test('rejected read-only feedback retains the last committed presentation state', async () => {
  let failing = false
  const f = fixture({ dependencies: { saveState: () => { if (failing) throw Error('Fixture checkpoint unavailable') } } })
  await f.watch.tick(); const first = f.watch.list().find(p => p.offered)
  await f.watch.presented([first.id]); failing = true
  await assert.rejects(f.watch.respond(first.id, 'done'), /checkpoint unavailable/)
  const displayed = f.frames.at(-1).proposals.find(p => p.id === first.id)
  assert.equal(displayed.status, 'pending')
  assert.equal(displayed.feedback, undefined)
  assert.equal(Object.keys(f.watch.handledOccurrences).length, 0)
  assert.equal(f.watch.storageFailure, true)
  assert.equal(f.actions.length, 0)
})

test('an explicit routine snooze resumes after its already acknowledged daily offer', async () => {
  const base = fixture().watch.config.rules[0]
  const f = fixture({ config: { rules: [{ ...base, delivery: 'routine', at: '10:00' }] } })
  await f.watch.tick(); const first = f.watch.list().find(p => p.offered)
  await f.watch.presented([first.id]); assert.equal(f.watch.config.routineDays.parcels, '2026-10-23')
  await f.watch.respond(first.id, 'snooze')
  f.clock(start + 60001); await f.watch.tick()
  assert.equal(f.frames.at(-1).popup, true)
  await f.watch.presented([first.id]); await f.watch.tick()
  assert.equal(f.frames.at(-1).popup, false)
  assert.equal(f.watch.list().find(p => p.id === first.id).snoozedUntil, undefined)
})

test('semantic cache refreshes timestamps and has a finite interval', async () => {
  const f = fixture({ config: { generationIntervalMs: 300000 } }); await f.watch.tick()
  f.clock(start + 1000); await f.watch.tick()
  assert.equal(f.requests.length, 1)
  assert.equal(f.watch.list().find(p => p.status === 'pending').evidence[0].measuredAt, new Date(start + 1000).toISOString())
  f.count(3); await f.watch.tick(); assert.equal(f.requests.length, 2)
  f.clock(start + 301001); await f.watch.tick(); assert.equal(f.requests.length, 3)
})

test('omitting a current need refreshes its evidence but changed premises expire it', async () => {
  const f = fixture(); await f.watch.tick(); const first = f.watch.list().find(p => p.offered)
  f.raw({ suggestions: [] }); f.clock(start + 1000); await f.watch.tick()
  assert.equal(f.watch.list().find(p => p.id === first.id).status, 'pending')
  assert.equal(f.watch.list().find(p => p.id === first.id).evidence[0].measuredAt, new Date(start + 1000).toISOString())
  f.count(0); await f.watch.tick()
  assert.equal(f.watch.list().find(p => p.id === first.id).status, 'expired')
})

test('automatic attention has a cooldown while explicit inspection remains available', async () => {
  const f = fixture({ config: { attentionCooldownMs: 60000 } }); await f.watch.tick()
  const first = f.watch.list().find(p => p.offered); await f.watch.presented([first.id])
  f.count(3); f.clock(start + 1000); await f.watch.tick()
  assert.equal(f.frames.at(-1).popup, false)
  assert.ok((await f.watch.readProposals()).some(p => p.status === 'pending'))
  assert.equal(f.frames.at(-1).popup, true)
})

test('urgent eligible needs outrank high probability routine and silent needs', async () => {
  const base = fixture().watch.config.rules[0]
  const f = fixture({ config: { rules: [{ ...base, id: 'routine', delivery: 'routine', at: '12:00' }, { ...base, id: 'silent', delivery: 'silent' }, { ...base, id: 'urgent', urgent: true }] } })
  await f.watch.tick()
  assert.equal(f.watch.list().filter(p => p.offered).length, 1)
  assert.ok(f.watch.list().filter(p => p.offered).every(p => p.ruleId === 'urgent'))
  assert.ok(f.watch.list().some(p => p.ruleId === 'routine' && p.status === 'pending'))
})

test('a malformed topic is isolated and healthy proposals remain readable and dismissible', async () => {
  const base = fixture().watch.config.rules[0]
  const f = fixture({ config: { rules: [base, { ...base, id: 'bad' }] }, dependencies: {
    generate: async ({ topics }) => {
      if (topics.some(t => t.id === 'bad')) throw Error('bad source model failure')
      return { suggestions: [{ topicId: topics[0].id, key: 'collect', advice: 'Collect parcels', reason: 'Pending count.', evidenceIds: [topics[0].evidence[0].id] }] }
    },
  } })
  await f.watch.tick()
  const p = (await f.watch.readProposals()).find(p => p.status === 'pending')
  assert.ok(p); assert.ok(f.watch.failedJudgments.has('bad'))
  await f.watch.respond(p.id, 'ignore'); assert.equal(f.watch.list().find(item => item.id === p.id).status, 'ignored')
})

test('judgment failure is isolated without lowering either 0.8 gate', async () => {
  const base = fixture().watch.config.rules[0]
  const f = fixture({ config: { rules: [base, { ...base, id: 'bad' }] }, dependencies: {
    judge: async ({ candidates }) => {
      if (candidates.some(c => c.ruleId === 'bad')) throw Error('Judgment unavailable')
      return answer(candidates)
    },
  } })
  await f.watch.tick()
  assert.ok(f.watch.list().some(p => p.ruleId === 'parcels' && p.status === 'pending'))
  assert.ok(f.watch.failedJudgments.has('bad'))
  assert.ok(f.watch.list().every(p => p.judgment.threshold === 0.8))
  const low = fixture({ dependencies: { judge: async ({ candidates }) => ({ model: 'jev-fixture', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.95, groundingProbability: 0.79, threshold: 0.8 }])) }) } })
  await low.watch.tick(); assert.equal(low.watch.list().length, 0)
})

test('bounded generation attempts report deferred failures and retry healthy topics later', async () => {
  const base = fixture().watch.config.rules[0]
  let calls = 0
  const f = fixture({ config: { maxGenerationCalls: 1, rules: [base, { ...base, id: 'bad' }] }, dependencies: {
    generate: async () => { calls++; throw Error('Unavailable generation') },
  } })
  await f.watch.tick()
  assert.equal(calls, 1)
  assert.deepEqual([...f.watch.failedJudgments].sort(), ['bad', 'parcels'])
  assert.match(f.frames.at(-1).error, /暂不可用/)
})

test('checkpoint migration preserves old acknowledged receipts and validates new feedback bounds', async t => {
  const { mkdtempSync, realpathSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { proposalStateStore } = await import('../src/proactive-state.mjs')
  const { protectProactivePath } = await import('../src/proactive-private.mjs')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proposal-occurrence-')))
  t.after(() => rmSync(directory, { recursive: true, force: true })); protectProactivePath(directory)
  const store = proposalStateStore(join(directory, 'state.json'))
  const f = fixture(); await f.watch.tick()
  const legacy = f.watch.list().filter(p => p.offered).map(p => {
    const { needKey, observationKey, occurrenceKey, reason, ...old } = p
    return { ...old, presented: true }
  })
  store.save({ version: 1, proposals: legacy })
  const next = fixture({ dependencies: { loadState: store.load, saveState: store.save } })
  await next.watch.tick()
  assert.equal(next.watch.list().find(p => p.id === legacy[0].id).presented, true)
  await next.watch.respond(legacy[0].id, 'snooze')
  const persisted = store.load()
  assert.equal(persisted.proposals.find(p => p.id === legacy[0].id).snoozedUntil, start + 60000)
  assert.ok(persisted.generationCache.parcels)
  for (const invalid of [{ snoozedUntil: -1 }, { snoozedUntil: Number.POSITIVE_INFINITY }, { feedback: 'approve' }, { occurrenceKey: 'forged' }, { reason: '\u0000' }]) {
    assert.throws(() => store.save({ ...persisted, proposals: [{ ...persisted.proposals[0], ...invalid }] }), /occurrence or feedback/)
  }
  store.save(persisted)
})

test('feedback tools require the actual explicit owner response for every new decision', async () => {
  const { createProposalTools } = await import('../src/proactive-tools.mjs')
  const commands = { done: '已处理', snooze: '稍后', useful: '有用', irrelevant: '不相关', incorrect: '不准确' }
  for (const [decision, text] of Object.entries(commands)) {
    let owner = 'unrelated conversation'
    const f = fixture(); await f.watch.tick(); const p = f.watch.list().find(p => p.offered)
    await f.watch.presented([p.id])
    const tool = createProposalTools(() => f.watch, () => owner).find(t => t.name === 'personal_agent_proposal_respond')
    await assert.rejects(tool.execute('test', { id: p.id, decision }), /Explicit proposal feedback/)
    owner = text
    await tool.execute('test', { id: p.id, decision })
    assert.equal(f.watch.list().find(item => item.id === p.id).feedback, decision)
    assert.equal(f.actions.length, 0)
  }
})

test('ambiguous spoken feedback cannot let a model choose another displayed proposal', async () => {
  const { createProposalTools } = await import('../src/proactive-tools.mjs')
  let owner = '已处理'
  const f = fixture({ config: { maxPush: 2 } }); await f.watch.tick()
  const [first, second] = f.watch.list(); await f.watch.presented([first.id, second.id])
  const tool = createProposalTools(() => f.watch, () => owner).find(t => t.name === 'personal_agent_proposal_respond')
  await assert.rejects(tool.execute('test', { id: second.id, decision: 'done' }), /explicitly selected/)
  owner = `已处理 ${first.id}`
  await assert.rejects(tool.execute('test', { id: second.id, decision: 'done' }), /explicitly selected/)
  await tool.execute('test', { id: first.id, decision: 'done' })
  assert.equal(f.watch.list().find(p => p.id === first.id).status, 'completed')
  assert.equal(f.watch.list().find(p => p.id === second.id).status, 'pending')
})

test('feedback audit excludes private contents and cannot overturn committed feedback', async () => {
  const receipts = []
  const f = fixture({ dependencies: { onFeedback: receipt => { receipts.push(receipt); throw Error('Diagnostics unavailable') } } })
  await f.watch.tick(); const p = f.watch.list().find(p => p.offered)
  await f.watch.respond(p.id, 'done')
  assert.equal(f.watch.list().find(item => item.id === p.id).status, 'completed')
  assert.deepEqual(receipts, [{ decision: 'done', at: new Date(start).toISOString(), ruleId: 'parcels', model: 'jev-fixture' }])
  assert.doesNotMatch(JSON.stringify(receipts), new RegExp(`${p.id}|${p.needKey}|Pending parcels|Collect parcels`))
})

test('handled identity archive admits the sixty-fifth changed need and survives restart', async () => {
  const f = fixture({ dependencies: { generate: async ({ topics }) => ({ suggestions: [{ topicId: topics[0].id, key: 'collect', advice: 'Collect parcels', reason: 'Pending count.', evidenceIds: [topics[0].evidence[0].id] }] }) } })
  for (let count = 1; count <= 65; count++) {
    f.count(count); await f.watch.tick()
    const current = f.watch.list().find(p => p.status === 'pending')
    assert.ok(current, `changed need ${count} must be admitted`)
    await f.watch.respond(current.id, 'done')
  }
  assert.equal(f.watch.list().length, 64)
  assert.equal(Object.keys(f.saved().handledOccurrences).length, 65)
  assert.ok(Object.values(f.saved().handledOccurrences).every(record => !('advice' in record) && !('evidence' in record)))
  const next = fixture({ dependencies: { loadState: f.saved } })
  next.count(65); await next.watch.tick()
  assert.ok(!next.watch.list().some(p => p.status === 'pending' && p.subject === 'parcels:collect'), 'an archived handled occurrence must not return')
})

test('legacy processed history releases capacity without evicting unknown execution', async () => {
  const seed = fixture(); await seed.watch.tick()
  const previous = seed.watch.list()[0]
  const proposals = Array.from({ length: 64 }, (_, i) => {
    const p = { ...structuredClone(previous), id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      subject: `parcels:legacy-${i}`, advice: `Previous need ${i}`, status: i === 63 ? 'unknown' : 'ignored' }
    delete p.needKey; delete p.observationKey; delete p.occurrenceKey
    return p
  })
  const unknown = structuredClone(proposals[63])
  const f = fixture({ dependencies: { loadState: () => ({ version: 1, proposals }),
    generate: async ({ topics }) => ({ suggestions: [{ topicId: topics[0].id, key: 'current-need', advice: 'A new current need.', reason: 'Current observed count.', evidenceIds: [topics[0].evidence[0].id] }] }) } })
  await f.watch.tick()
  assert.equal(f.watch.list().length, 64)
  assert.equal(f.watch.list().filter(p => p.status === 'pending').length, 1)
  assert.deepEqual(f.watch.list().find(p => p.id === unknown.id), unknown)
})

test('one generation call per round eventually isolates a permanently broken topic', async () => {
  const base = fixture().watch.config.rules[0], requests = []
  const f = fixture({ config: { maxGenerationCalls: 1, rules: [base, { ...base, id: 'bad' }] }, dependencies: {
    generate: async ({ topics }) => {
      requests.push(topics.map(t => t.id))
      if (topics.some(t => t.id === 'bad')) throw Error('Broken topic')
      return { suggestions: [{ topicId: topics[0].id, key: 'collect', advice: 'Collect parcels', reason: 'Pending count.', evidenceIds: [topics[0].evidence[0].id] }] }
    },
  } })
  await f.watch.tick(); await f.watch.tick(); await f.watch.tick()
  assert.ok(f.watch.list().some(p => p.ruleId === 'parcels' && p.status === 'pending'))
  assert.deepEqual(requests, [['parcels', 'bad'], ['parcels'], ['bad']])
  assert.deepEqual(f.saved().isolatedTopics, ['bad'])
})

test('an explicit ignore or mute UUID cannot target a different proposal', async () => {
  const { createProposalTools } = await import('../src/proactive-tools.mjs')
  const f = fixture({ config: { maxPush: 2 } }); await f.watch.tick()
  const [first, second] = f.watch.list(); await f.watch.presented([first.id, second.id])
  for (const decision of ['ignore', 'mute']) {
    const tool = createProposalTools(() => f.watch, () => `${decision} ${first.id}`).find(t => t.name === 'personal_agent_proposal_respond')
    await assert.rejects(tool.execute('test', { id: second.id, decision }), /owner selected/)
  }
  assert.ok(f.watch.list().every(p => p.status === 'pending'))
  assert.deepEqual(f.watch.config.suppressed, [])
})

test('full unresolved capacity reports its boundary and recovers after owner feedback', async () => {
  let batch = 0
  const f = fixture({ config: { maxCandidates: 16 }, dependencies: { generate: async ({ topics }) => ({ suggestions: Array.from({ length: batch < 4 ? 16 : 1 }, (_, i) => ({
    topicId: topics[0].id, key: `need-${batch}-${i}`, advice: `Check parcel item ${batch}-${i}`, reason: 'Pending count.', evidenceIds: [topics[0].evidence[0].id],
  })) }) } })
  for (; batch < 4; batch++) await f.watch.tick()
  assert.equal(f.watch.list().filter(p => p.status === 'pending').length, 64)
  await f.watch.tick()
  assert.match(f.frames.at(-1).error, /容量已满/)
  assert.equal(f.watch.list().length, 64)
  assert.equal((await f.watch.readProposals()).filter(p => p.status === 'pending').length, 64)
  const first = f.watch.list()[0]
  await f.watch.respond(first.id, 'done'); await f.watch.tick()
  assert.ok(f.watch.list().some(p => p.subject === 'parcels:need-4-0' && p.status === 'pending'))
  assert.equal(f.watch.judgmentError, '')
})

test('a cleared need can recur with the same values across a restart', async () => {
  const dependencies = { generate: async ({ topics }) => ({ suggestions: topics[0].evidence[0].value === 0 ? [] : [{
    topicId: topics[0].id, key: 'collect', advice: 'Collect parcels', reason: 'Pending count.', evidenceIds: [topics[0].evidence[0].id],
  }] }) }
  const f = fixture({ dependencies }); f.count(1); await f.watch.tick()
  const original = f.watch.list().find(p => p.status === 'pending'); await f.watch.respond(original.id, 'done')
  const unchanged = fixture({ dependencies: { ...dependencies, loadState: f.saved } }); unchanged.count(1); await unchanged.watch.tick()
  assert.equal(unchanged.watch.list().filter(p => p.status === 'pending').length, 0)
  unchanged.count(0); await unchanged.watch.tick()
  assert.equal(unchanged.saved().observationEpisodes.parcels.sequence, 1)
  const restarted = fixture({ dependencies: { ...dependencies, loadState: unchanged.saved } }); restarted.count(1); await restarted.watch.tick()
  const next = restarted.watch.list().find(p => p.status === 'pending')
  assert.ok(next); assert.notEqual(next.occurrenceKey, original.occurrenceKey)
  assert.equal(restarted.saved().observationEpisodes.parcels.sequence, 2)
})

test('offline reads do not create episodes and old handled checkpoints migrate without resurrection', async () => {
  const f = fixture(); await f.watch.tick(); const first = f.watch.list().find(p => p.offered); await f.watch.respond(first.id, 'done')
  const legacy = f.saved(); delete legacy.observationEpisodes
  const next = fixture({ dependencies: { loadState: () => legacy } }); await next.watch.tick()
  assert.equal(next.watch.list().find(p => p.id === first.id).status, 'completed')
  assert.equal(next.saved().observationEpisodes.parcels.sequence, 0)
  const before = structuredClone(next.saved().observationEpisodes)
  next.watch.read = async id => ({ id, state: 'unavailable', value: null })
  await next.watch.tick()
  assert.deepEqual(next.saved().observationEpisodes, before)
})

test('a full receipt archive recovers after an old rule changes or is removed without discarding unknown actions', async t => {
  const { mkdtempSync, realpathSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { randomUUID } = await import('node:crypto')
  const { proposalStateStore } = await import('../src/proactive-state.mjs')
  const { handledReceipt, generationKey } = await import('../src/proactive-lifecycle.mjs')
  const { protectProactivePath } = await import('../src/proactive-private.mjs')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'odk-proposal-capacity-')))
  t.after(() => rmSync(directory, { recursive: true, force: true })); protectProactivePath(directory)
  const store = proposalStateStore(join(directory, 'state.json'))
  const seed = fixture(); await seed.watch.tick()
  const initial = seed.saved(), [pending, complete] = initial.proposals
  complete.status = 'completed'; complete.completedAt = new Date(start).toISOString()
  const receipt = handledReceipt(complete)
  initial.handledOccurrences = Object.fromEntries(Array.from({ length: 1023 }, (_, i) => {
    const key = i.toString(16).padStart(64, '0'); return [key, { ...receipt, occurrenceKey: key }]
  }))
  initial.handledOccurrences[complete.occurrenceKey] = receipt
  const unknown = { ...pending, id: randomUUID(), subject: 'parcels:uncertain', advice: 'Unconfirmed external action', status: 'unknown', action: { tool: 'coding_task_start', params: {} }, result: 'Outcome unknown.' }
  initial.proposals.push(unknown)
  for (const remove of [false, true]) {
    store.save(initial)
    const full = fixture({ dependencies: { loadState: store.load, saveState: store.save } }); await full.watch.tick()
    await assert.rejects(full.watch.respond(pending.id, 'done'), /receipt capacity/)
    assert.equal(full.watch.storageFailure, true)
    assert.match(full.frames.at(-1).error, /修改或移除.*重启/)
    assert.equal(store.load().proposals.find(p => p.id === pending.id).status, 'pending')
    const rule = { ...seed.watch.config.rules[0], goal: 'New current goal', ...(remove ? { id: 'replacement' } : {}) }
    const recovered = fixture({ config: { rules: [rule] }, dependencies: { loadState: store.load, saveState: store.save } }); await recovered.watch.tick()
    const proposal = recovered.watch.list().find(p => p.ruleVersion === JSON.stringify(rule) && p.status === 'pending')
    assert.ok(proposal); await recovered.watch.respond(proposal.id, 'done')
    assert.equal(Object.keys(store.load().handledOccurrences).length, 1)
    assert.ok(Object.values(store.load().handledOccurrences).every(r => r.ruleVersionKey === generationKey(JSON.stringify(rule))))
    assert.equal(store.load().proposals.find(p => p.id === unknown.id).status, 'unknown')
    assert.equal(recovered.actions.length, 0)
  }
})

test('consumer readiness recovers a missed offer without inference or presentation', async () => {
  const f = fixture({ config: { attentionCooldownMs: 60000 } }); await f.watch.tick()
  const first = f.watch.list().find(p => p.offered)
  const generated = f.requests.length, attention = f.watch.lastAttentionAt
  f.frames.length = 0
  f.watch.consumerReady?.()
  assert.equal(f.frames.at(-1)?.popup, true)
  assert.equal(f.frames.at(-1)?.recovery, true)
  assert.equal(f.frames.at(-1)?.proposals.find(p => p.id === first.id).presented, false)
  assert.equal(f.requests.length, generated)
  assert.equal(f.watch.lastAttentionAt, attention)
  await f.watch.presented([first.id]); f.watch.consumerReady?.()
  assert.equal(f.frames.at(-1).popup, false, 'presented offers are never replayed')
})

test('consumer recovery defers to busy and quiet policy without spending attention twice', async () => {
  const f = fixture({ config: { attentionCooldownMs: 60000 } }); await f.watch.tick()
  const id = f.watch.list().find(p => p.offered).id
  f.watch.setBusy(true); f.watch.consumerReady()
  assert.equal(f.frames.at(-1).popup, false)
  f.watch.config.quietHours = { start: '09:00', end: '11:00', timeZone: 'UTC' }
  f.watch.setBusy(false); assert.equal(f.frames.at(-1).popup, false)
  f.watch.config.quietHours = undefined; f.watch.emit()
  assert.equal(f.frames.at(-1).popup, true)
  assert.equal(f.frames.at(-1).recovery, true)
  assert.equal(f.frames.at(-1).proposals.find(p => p.id === id).presented, false)
  f.watch.emit(); assert.equal(f.frames.at(-1).popup, false, 'one readiness episode does not repeatedly open an unacknowledged offer')
})

test('consumer recovery preserves routine receipts, snooze, silence, suppression and expiration', async () => {
  for (const policy of ['routine', 'snooze', 'silent', 'suppressed', 'expired']) {
    const f = fixture({ dependencies: { generate: async ({ topics }) => ({ suggestions: topics.map(topic => ({ topicId: topic.id, key: 'collect', advice: 'Check parcels.', reason: 'Pending parcels.', evidenceIds: [topic.evidence[0].id] })) }) } }); await f.watch.tick()
    const p = f.watch.proposals.find(p => p.offered)
    if (policy === 'routine') {
      Object.assign(f.watch.config.rules[0], { delivery: 'routine', at: '09:00' }); p.routineDay = '2026-10-23'
      f.watch.consumerReady(); assert.equal(f.frames.at(-1).popup, true, 'an unpresented routine can recover its own offer')
      f.watch.config.routineDays.parcels = '2026-10-23'
    } else if (policy === 'snooze') { await f.watch.respond(p.id, 'snooze') }
    else if (policy === 'silent') f.watch.config.rules[0].delivery = 'silent'
    else if (policy === 'suppressed') f.watch.config.suppressed = ['parcels']
    else f.clock(start + 1800001)
    f.watch.consumerReady(); assert.equal(f.frames.at(-1).popup, false, policy)
  }
})

test('application recovery uses the attached optional Watch and never retains a popup snapshot', async () => {
  const forbidden = async () => { throw Error('No owner or action call is permitted') }
  const service = new PersonalAgentService({ record: forbidden, transcribe: forbidden, prompt: forbidden })
  const f = fixture({ dependencies: { publish: frame => service.propose(frame) } })
  service.attachWatch(f.watch); await f.watch.tick()
  const first = service.status.proposals.find(p => p.offered)
  assert.equal(service.status.proposalPopup, false)
  const frames = []; const release = service.subscribe(frame => frames.push(frame))
  service.consumerReady()
  assert.equal(frames.at(-1).proposalPopup, true)
  assert.equal(frames.at(-1).proposalRecovery, true)
  assert.equal(frames.at(-1).proposals.find(p => p.id === first.id).presented, false)
  assert.equal(service.status.proposalPopup, false)
  assert.equal(service.status.proposalRecovery, false)
  service.attachWatch({}); service.consumerReady()
  service.attachWatch(undefined); service.consumerReady()
  assert.equal(f.requests.length, 1)
  release(); await f.watch.close(); await service.close()
})

test('multiple unpresented offers from one routine topic recover within the original push bound', async () => {
  const f = fixture({ config: { maxPush: 2, rules: [{ id: 'parcels', goal: 'Handle pending parcels', delivery: 'routine', at: '09:00', urgent: false, observations: [{ readingId: 'parcels', fields: ['count'] }] }] } })
  await f.watch.tick()
  assert.equal(f.watch.list().filter(p => p.offered).length, 2)
  f.watch.consumerReady()
  assert.equal(f.frames.at(-1).popup, true)
  assert.equal(f.frames.at(-1).recovery, true)
  assert.ok(f.frames.at(-1).proposals.every(p => !p.presented))
})
