import { protectProactivePath } from '../src/proactive-private.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIntentStore, createIntentRuntime } from '../src/intents.mjs'
const wish = { wish: '每天十一点半考虑从公司去附近健身房，先看行程', condition: '有空并计划健身时', at: '11:30', timeZone: 'Asia/Shanghai', windowMinutes: 10, memoryKeys: ['habit'], observations: [], ride: { city: '测试城市', from: '公司', to: '健身房' } }
const fixture = t => { const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-intents-'))); protectProactivePath(dir); t.after(() => rmSync(dir, { recursive: true, force: true })); return createIntentStore(join(dir, 'intent.md')) }
const time = '2026-10-17T03:31:00.000Z'
function host(store, condition, preview, now = () => Date.parse(time)) {
  const runtime = createIntentRuntime({ store, memory: async () => ({ habit: '午间健身，但不知道今天是否有空' }), read: async () => null, judge: condition, previewRide: preview, now })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), closed: false, interactionRevision: 0 }
  return { runtime, watch }
}
test('Given a conversational wish, intent.md retains language and rejects executable authority', t => {
  const store = fixture(t); const entry = store.save(wish)
  assert.equal(store.list()[0].wish, wish.wish); assert.ok(readFileSync(store.file, 'utf8').includes(wish.condition))
  assert.throws(() => store.save({ ...wish, action: { tool: 'didi_submit' } }), /Invalid/)
  store.save({ ...wish, id: entry.id, revision: entry.revision, at: '11:40' })
  assert.throws(() => store.save({ ...wish, id: entry.id, revision: entry.revision }), /changed/)
})
test('Given unknown/false conditions, no MCP call occurs and the checkpoint explains why', async t => {
  for (const status of ['unknown', 'false']) {
    const store = fixture(t); store.save(wish)
    const { runtime, watch } = host(store, async () => ({ status, model: 'jev-test' }), () => assert.fail('MCP before condition'))
    await runtime.prepare(watch); assert.equal(watch.intentClaims[0].status, `condition_${status}`); assert.equal(runtime.rules().length, 0)
  }
})
test('Given an in-flight preview, persisted claims prevent replay and edits reject late output', async t => {
  const store = fixture(t); const entry = store.save(wish); let finish, calls = 0
  const { runtime, watch } = host(store, async () => ({ status: 'true', model: 'jev-test' }), async () => { calls++; assert.equal(watch.intentClaims[0].status, 'preparing'); return new Promise(resolve => { finish = resolve }) })
  const polling = runtime.prepare(watch)
  for (let i = 0; !finish && i < 100; i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(finish, 'preview must actually start')
  store.save({ ...wish, id: entry.id, revision: entry.revision, at: '11:35' })
  finish({ status: 'ready', handle: 'not-authority', from: [], to: [] }); await polling
  assert.equal(runtime.rules().length, 0); assert.equal(watch.intentClaims[0].status, 'superseded'); assert.equal(calls, 1)
})
test('Given a ready occurrence, restart and late heartbeat never replay it', async t => {
  const store = fixture(t); store.save(wish); let calls = 0
  const { runtime, watch } = host(store, async () => ({ status: 'true', model: 'jev-test' }), async () => { calls++; return { status: 'ready', handle: 'reviewed', from: [], to: [], expiresAt: Date.parse(time) + 120000 } })
  await runtime.prepare(watch); assert.equal(runtime.rules().length, 1); await runtime.prepare(watch); assert.equal(calls, 1)
  const restart = host(store, () => assert.fail('claimed'), () => assert.fail('claimed')); restart.watch.intentClaims = structuredClone(watch.intentClaims)
  await restart.runtime.prepare(restart.watch); assert.equal(restart.runtime.rules().length, 0)
  const late = host(store, () => assert.fail('late'), () => assert.fail('late'), () => Date.parse('2026-10-18T03:41:00Z'))
  await late.runtime.prepare(late.watch); assert.equal(late.watch.intentClaims.length, 0)
})

test('Given a saved Intent, the real Watch generates, grounds and delivers without an action; mute invalidates it', async t => {
  const { ProactiveWatch } = await import('../src/proactive.mjs')
  const { proposalStateStore } = await import('../src/proactive-state.mjs')
  const store = fixture(t), entry = store.save(wish)
  const checkpoint = proposalStateStore(join(store.file, '..', 'state.json'))
  const events = [], frames = []
  const runtime = createIntentRuntime({ store, memory: async () => ({ habit: '午间健身' }), read: async () => null,
    judge: async () => { events.push('condition'); return { status: 'true', model: 'jev-test' } },
    previewRide: async () => { events.push('preview'); return { status: 'quoted', handle: 'real-handle', measuredAt: time, from: [{ handle: 'from-real', name: '测试起点', city: '测试市', address: '', location: { lng: 1, lat: 2 } }], to: [{ handle: 'to-real', name: '测试终点', city: '测试市', address: '', location: { lng: 1, lat: 2 } }], items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }], expiresAt: Date.parse(time) + 120000 } }, now: () => Date.parse(time) })
  const options = { config: { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }, intents: runtime,
    now: () => Date.parse(time), loadState: checkpoint.load, saveState: checkpoint.save, publish: frame => frames.push(frame), save: async () => assert.fail('Intent mute must not modify an owner JSON file'),
    generate: async ({ topics }) => { events.push('generate'); return { suggestions: [{ topicId: topics[0].id, key: 'daily-ride', advice: '查看今天的行程方案。', nextStep: 'Open the referenced source and inspect the pending item.', evidenceIds: topics[0].evidence.map(e => e.id) }] } },
    judge: async ({ candidates }) => { events.push('grounding'); return { model: 'jev-test', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: 0.95, groundingProbability: 0.95, threshold: 0.8 }])) } },
    read: async () => assert.fail('Intent adapter owns its evidence'), execute: async () => assert.fail('Never order'), phrase: async () => assert.fail('Generated flow unchanged') }
  const watch = new ProactiveWatch(options); t.after(() => watch.close())
  await watch.tick(); assert.deepEqual(events, ['condition', 'preview', 'generate', 'grounding'])
  const p = watch.list()[0]; assert.equal(p.action, null); assert.equal(p.confirmation, ''); assert.equal(p.ridePreview.items[0].priceText, '20元'); assert.equal(frames.at(-1).popup, true)
  await watch.presented([p.id]); await watch.tick(); assert.equal(frames.at(-1).popup, false)
  assert.equal(checkpoint.load().intentClaims.length, 1)
  await watch.respond(p.id, 'mute'); assert.equal(store.list().find(e => e.id === entry.id).enabled, false); assert.equal(watch.list()[0].status, 'ignored')
})

test('Given a daily window crossing midnight, its occurrence belongs to the preceding local day', async t => {
  const store = fixture(t); store.save({ ...wish, at: '23:55' })
  const { runtime, watch } = host(store, async () => ({ status: 'true', model: 'jev-test' }), async () => ({ status: 'needs_location' }), () => Date.parse('2026-10-17T16:01:00Z'))
  await runtime.prepare(watch); assert.equal(watch.intentClaims[0]?.date, '2026-10-17'); assert.equal(runtime.rules().length, 1)
})
test('Given a full old occurrence history, a new day still works and a clock rollback never replays an archived claim', async t => {
  const store = fixture(t), entry = store.save(wish); let clock = Date.parse(time), calls = 0
  const { runtime, watch } = host(store, async () => ({ status: 'true', model: 'jev-test' }), async () => { calls++; return { status: 'needs_location' } }, () => clock)
  watch.intentClaims = Array.from({ length: 256 }, (_, i) => { const date = new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10); return { key: `${entry.id}:1:${date}`, intentId: entry.id, revision: 1, date, status: 'failed', updatedAt: '2025-01-01T00:00:00Z' } })
  await runtime.prepare(watch); assert.equal(calls, 1); assert.ok(watch.intentClaims.length <= 256); assert.ok(watch.intentArchive.count > 0)
  clock = Date.parse('2025-01-01T03:31:00Z'); await runtime.prepare(watch); assert.equal(calls, 1)
})

test('Given a real selected-source push during condition judgment, the Watch rejects that older discovery', async t => {
  const { ProactiveWatch } = await import('../src/proactive.mjs')
  const store = fixture(t); store.save({ ...wish, observations: [{ readingId: 'calendar', fields: ['free'] }] })
  let release, calls = 0, judgments = 0
  const runtime = createIntentRuntime({ store, memory: async () => ({}), now: () => Date.parse(time),
    read: async id => ({ id, state: 'live', value: { free: true, measured_at: time } }),
    judge: async () => ++judgments === 1 ? new Promise(resolve => { release = () => resolve({ model: 'jev-test', status: 'true' }) }) : { model: 'jev-test', status: 'true' }, previewRide: async () => { calls++; return { status: 'needs_location' } } })
  const watch = new ProactiveWatch({ config: { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }, intents: runtime, now: () => Date.parse(time), publish: () => {}, save: async () => {}, read: async () => null })
  t.after(() => watch.close())
  const pending = watch.tick()
  for (let i = 0; !release && i < 100; i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(release); assert.equal(watch.push(['calendar']), true)
  release(); await pending
  assert.equal(calls, 0); assert.equal(watch.intentClaims[0].status, 'condition_unknown'); assert.equal(watch.list().length, 0)
  await watch.tick(); assert.equal(calls, 1, 'The newer stable context gets its own condition judgment before first discovery'); assert.equal(judgments, 2)
})

test('Given a context-only Intent, a heartbeat uses actual context without requiring a time field', async t => {
  const store = fixture(t); const { at: _at, ...contextWish } = wish; store.save(contextWish)
  const { runtime, watch } = host(store, async ({ memory }) => { assert.equal(memory.habit, '午间健身，但不知道今天是否有空'); return { model: 'jev-test', status: 'unknown' } }, () => assert.fail('Unknown context'))
  await runtime.prepare(watch); assert.equal(watch.intentClaims[0].status, 'condition_unknown')
})

test('Given unchanged context, negative and unknown judgments are cached until relevant notes or a bounded clock boundary change', async t => {
  const store = fixture(t); const { at: _at, ...contextWish } = wish; store.save(contextWish)
  let notes = { habit: '午间健身' }, clock = Date.parse(time), judgments = 0
  const runtime = createIntentRuntime({ store, memory: async () => notes, read: async () => null, now: () => clock,
    judge: async () => { judgments++; return { status: 'unknown', model: 'jev-test' } }, previewRide: () => assert.fail('No sufficient evidence') })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), interactionRevision: 0, closed: false }
  await runtime.prepare(watch); await runtime.prepare(watch); assert.equal(judgments, 1)
  notes = { habit: '今天不健身' }; await runtime.prepare(watch); assert.equal(judgments, 2)
  clock += 3600000; await runtime.prepare(watch); assert.equal(judgments, 3)
})

test('Given one memory-referenced Intent, changed actual notes change MCP searches and revoke old route handles', async t => {
  const { createMemoryStore } = await import('../src/memory.mjs')
  const { createRidePreview } = await import('../src/didi/preview.mjs')
  const store = fixture(t), notes = createMemoryStore(join(store.file, '..', 'MEMORY.md'))
  const remember = async (key, value) => { notes.beginTurn(`remember ${key}: ${value}`); await notes.update({ category: key, value }); notes.beginTurn('') }
  await remember('city', '测试市'); await remember('company', '测试办公楼'); await remember('gym', '测试健身馆甲')
  const entry = store.save({ ...wish, condition: '每天提醒', memoryKeys: [], ride: { cityMemoryKey: 'city', fromMemoryKey: 'company', toMemoryKey: 'gym' } })
  let clock = Date.parse(time); const searches = []
  const previews = createRidePreview({ now: () => clock, call: async (name, args) => {
    if (name === 'maps_textsearch') { searches.push({ ...args }); return [{ display_name: args.keywords, city: args.city, location: { lng: 1, lat: 2 } }] }
    assert.equal(name, 'taxi_estimate'); return { traceId: 'private-provider-trace', items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] }
  } })
  const runtime = createIntentRuntime({ store, now: () => clock, memory: async () => JSON.parse(await notes.read()), memoryVersion: keys => notes.version(keys), read: async () => null,
    judge: async ({ memory }) => { assert.equal(memory.company, '测试办公楼'); return { status: 'true', model: 'jev-test' } }, previewRide: previews.search })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), interactionRevision: 0, closed: false }
  await runtime.prepare(watch)
  const old = runtime.details(`intent-${entry.id}`)
  assert.deepEqual(searches, [{ city: '测试市', keywords: '测试办公楼' }, { city: '测试市', keywords: '测试健身馆甲' }])
  await remember('gym', '测试健身馆乙')
  assert.throws(() => previews.route({ handle: old.handle, from: old.from[0].handle, to: old.to[0].handle }), /changed|expired/)
  clock += 86400000; await runtime.prepare(watch)
  assert.equal(searches.at(-1).keywords, '测试健身馆乙'); assert.equal(store.list()[0].revision, entry.revision)
  assert.equal(JSON.stringify(runtime.details(`intent-${entry.id}`)).includes('private-provider-trace'), false)
})

test('Given an explicit owner route, old Memory cannot replace its named endpoint', async t => {
  const store = fixture(t); store.save({ ...wish, condition: '每天提醒', memoryKeys: [], ride: { city: '测试市', from: '本轮明确起点', to: '本轮明确终点', toMemoryKey: 'gym' } })
  let called = false
  const runtime = createIntentRuntime({ store, now: () => Date.parse(time), memory: async () => ({ gym: '旧终点' }), read: async () => null,
    judge: async () => ({ status: 'true', model: 'jev-test' }), previewRide: async route => { called = true; assert.equal(route.to, '本轮明确终点'); return { status: 'needs_location' } } })
  await runtime.prepare({ intentClaims: [], persist() {}, controller: new AbortController(), closed: false, interactionRevision: 0 })
  assert.equal(called, true)
})

test('Given a timed condition, a later minute in its bounded window can change a cached false judgment', async t => {
  const store = fixture(t); store.save({ ...wish, condition: '11:35 后才提醒' })
  let clock = Date.parse(time), calls = 0
  const { runtime, watch } = host(store, async ({ local }) => { calls++; return { model: 'jev-test', status: local.time >= '11:35' ? 'true' : 'false' } }, async () => ({ status: 'needs_location' }), () => clock)
  await runtime.prepare(watch); await runtime.prepare(watch); assert.equal(calls, 1)
  clock += 5 * 60000; await runtime.prepare(watch); assert.equal(calls, 2); assert.equal(runtime.rules().length, 1)
})

test('ordinary model condition identity survives the same bounded Intent occurrence flow', async t => {
  const store=fixture(t);store.save(wish)
  const {runtime,watch}=host(store,async()=>({status:'true',model:'synthetic/model-v1'}),async()=>({status:'needs_location',message:'Synthetic location remains unknown'}))
  await runtime.prepare(watch)
  assert.equal(watch.intentClaims[0].status,'ready');assert.equal(watch.intentClaims[0].model,'synthetic/model-v1')
  assert.equal(runtime.rules().length,1)
})


async function readyPreviewFixture(t, { conditionGate, discoveryGate, generationGate } = {}) {
  const { ProactiveWatch } = await import('../src/proactive.mjs')
  const { createRidePreview } = await import('../src/didi/preview.mjs')
  const store = fixture(t), entry = store.save({ ...wish, observations: [{ readingId: 'owner.context', fields: ['available'] }] })
  let clock = Date.parse(time), memoryRevision = 0
  const calls = [], frames = []
  const previews = createRidePreview({ now: () => clock, call: async (name, args) => {
    calls.push(name)
    if (name === 'maps_textsearch') { await discoveryGate?.(); return [{ display_name: args.keywords, city: args.city, location: { lng: 1, lat: 2 } }] }
    assert.equal(name, 'taxi_estimate')
    return { traceId: 'private-provider-trace', items: [{ productName: 'Fixture ride', productCategory: '1', priceText: '20' }] }
  } })
  const runtime = createIntentRuntime({ store, now: () => clock, memory: async () => ({ habit: 'Habit data only' }), memoryVersion: () => String(memoryRevision),
    read: async id => ({ id, state: 'live', value: { available: true, measured_at: new Date(clock).toISOString() } }),
    judge: async () => { await conditionGate?.(); return { model: 'jev-test', status: 'true' } }, previewRide: previews.search })
  const watch = new ProactiveWatch({ config: { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} },
    now: () => clock, intents: runtime, publish: frame => frames.push(frame), save: async () => assert.fail('No owner config write'),
    generate: async ({ topics }) => { await generationGate?.(); return { suggestions: [{ topicId: topics[0].id, key: 'ride-preview', advice: '查看当前行程方案。', nextStep: '查看候选并选择起终点。', evidenceIds: topics[0].evidence.map(e => e.id) }] } },
    judge: async ({ candidates }) => ({ model: 'jev-test', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: .95, groundingProbability: .95, threshold: .8 }])) }),
    read: async () => assert.fail('Intent owns evidence'), execute: async () => assert.fail('Preview never executes an action') })
  t.after(() => watch.close())
  const route = preview => previews.route({ handle: preview.handle, from: preview.from[0].handle, to: preview.to[0].handle })
  return { watch, runtime, store, entry, calls, frames, route, changeMemory: () => { memoryRevision++ }, advance: ms => { clock += ms } }
}

test('Given Useful feedback, completed Intent and manual previews retain pending proposals and actual route handles', async t => {
  const f = await readyPreviewFixture(t)
  await f.watch.tick()
  const proposal = f.watch.list()[0]
  await f.watch.presented([proposal.id])
  const oldPreview = f.runtime.details(proposal.ruleId)
  await f.watch.respond(proposal.id, 'useful')
  assert.equal(f.watch.list()[0].status, 'pending')
  assert.equal(f.watch.list()[0].feedback, 'useful')
  assert.equal(f.watch.intentClaims[0].status, 'ready')
  assert.equal(f.runtime.rules().length, 1)
  assert.equal(f.route(oldPreview).to_name, wish.ride.to)
  await assert.rejects(f.watch.respond(proposal.id, 'accept'), /confirmation|action/i)
  // Owner-requested refresh produces a new read-only preview through the same provider.
  const owner = new AbortController()
  await f.runtime.refreshPreview(oldPreview.handle, f.watch, `刷新行程 ${oldPreview.handle}`, owner.signal)
  const refreshed = f.runtime.details(proposal.ruleId)
  owner.abort()
  f.watch.setBusy(true); f.watch.setBusy(false)
  await f.watch.respond(proposal.id, 'useful')
  assert.equal(f.watch.list()[0].status, 'pending')
  assert.equal(f.route(refreshed).to_name, wish.ride.to)
  assert.equal(f.watch.list()[0].action, null)
  assert.equal(f.watch.list()[0].confirmation, '')
  assert.deepEqual(f.calls, ['maps_textsearch', 'maps_textsearch', 'taxi_estimate', 'maps_textsearch', 'maps_textsearch', 'taxi_estimate'])
})

test('Given completed Intent previews, stable context changes still revoke proposals and route handles after Useful', async t => {
  for (const boundary of ['memory', 'source', 'intent', 'window', 'expiry', 'close']) await t.test(boundary, async t => {
    const f = await readyPreviewFixture(t)
    await f.watch.tick()
    const proposal = f.watch.list()[0], preview = f.runtime.details(proposal.ruleId)
    await f.watch.presented([proposal.id]); await f.watch.respond(proposal.id, 'useful')
    assert.equal(f.watch.list()[0].status, 'pending')
    if (boundary === 'memory') f.changeMemory()
    if (boundary === 'source') f.watch.push(['owner.context'])
    if (boundary === 'intent') f.store.save({ ...f.entry, enabled: false })
    if (boundary === 'window') f.advance(11 * 60000)
    if (boundary === 'expiry') f.advance(120001)
    if (boundary === 'close') await f.watch.close()
    assert.equal(f.runtime.rules().length, 0)
    assert.throws(() => f.route(preview), /changed|expired/)
  })
})

test('Given unfinished Intent condition, discovery or generation, actual owner feedback still cancels late output', async t => {
  for (const phase of ['condition', 'discovery', 'generation']) await t.test(phase, async t => {
    let release, enter, armed = false
    const entered = new Promise(resolve => { enter = resolve }), held = new Promise(resolve => { release = resolve })
    const gate = async () => { if (armed) { enter(); await held } }
    const f = await readyPreviewFixture(t, { [phase + 'Gate']: gate })
    await f.watch.tick()
    const existing = f.watch.list()[0]
    await f.watch.presented([existing.id])
    const previousCalls = f.calls.length, previousFrames = f.frames.length
    f.store.save({ ...wish, observations: [{ readingId: 'owner.context', fields: ['available'] }] })
    armed = true
    const tick = f.watch.tick()
    await entered; await f.watch.respond(existing.id, 'useful'); release(); await tick
    assert.deepEqual(f.watch.list().map(p => [p.id, p.status]), [[existing.id, 'pending']])
    assert.equal(f.frames.slice(previousFrames).some(frame => frame.popup), false)
    if (phase === 'condition') assert.equal(f.calls.length, previousCalls)
    if (phase === 'discovery') assert.deepEqual(f.calls.slice(previousCalls), ['maps_textsearch'])
  })
})

test('Given an unfinished manual preview, changed owner context rejects late discovery without replacing prior handles', async t => {
  for (const boundary of ['signal', 'feedback', 'owner-current']) await t.test(boundary, async t => {
    let release, enter, armed = false, ownerCurrent = true
    const entered = new Promise(resolve => { enter = resolve }), held = new Promise(resolve => { release = resolve })
    const f = await readyPreviewFixture(t, { discoveryGate: async () => { if (armed) { enter(); await held } } })
    await f.watch.tick()
    const proposal = f.watch.list()[0], original = f.runtime.details(proposal.ruleId), owner = new AbortController()
    await f.watch.presented([proposal.id])
    armed = true
    const refresh = f.runtime.refreshPreview(original.handle, f.watch, `刷新行程 ${original.handle}`, owner.signal, () => ownerCurrent)
    await entered
    if (boundary === 'signal') owner.abort()
    if (boundary === 'feedback') await f.watch.respond(proposal.id, 'useful')
    if (boundary === 'owner-current') ownerCurrent = false
    release()
    await assert.rejects(refresh, /abort|Intent changed|owner turn changed/i)
    assert.equal(f.runtime.details(proposal.ruleId).handle, original.handle)
    assert.equal(f.route(original).to_name, wish.ride.to)
    assert.equal(f.calls.length, 4)
  })
})
