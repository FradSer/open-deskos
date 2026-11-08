import { protectProactivePath } from '../src/proactive-private.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { createIntentStore, createIntentRuntime, ROUTINE_FILENAME } from '../src/recommendations/index.mjs'
const wish = { wish: '每天十一点半考虑从公司去附近健身房，先看行程', condition: '有空并计划健身时', at: '11:30', timeZone: 'Asia/Shanghai', windowMinutes: 10, memoryKeys: ['habit'], observations: [], ride: { city: '测试城市', from: '公司', to: '健身房' } }
const fixture = t => { const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-intents-'))); protectProactivePath(dir); t.after(() => rmSync(dir, { recursive: true, force: true })); return createIntentStore(join(dir, ROUTINE_FILENAME)) }
const time = '2026-10-17T03:31:00.000Z'
function host(store, condition, preview, now = () => Date.parse(time)) {
  const runtime = createIntentRuntime({ store, memory: async () => ({ notes: { habit: '午间健身，但不知道今天是否有空' } }), read: async () => null, judge: condition, previewRide: preview, now })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), closed: false, interactionRevision: 0 }
  return { runtime, watch }
}
test('Given a conversational wish, the routine separates When, If and Then and retains the original request', t => {
  const store = fixture(t)
  const ownerText = '请在适合的时候建议这趟行程。\n第二行 [说明](https://example.test) <!-- -->'
  const entry = store.save({ ...wish, ownerText })
  assert.deepEqual(store.list(), [entry])
  const { version, entries: records } = parseYaml(readFileSync(store.file, 'utf8'))
  assert.equal(version, 2)
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].when, { type: 'daily-window', at: '11:30', timeZone: 'Asia/Shanghai', windowMinutes: 10 })
  assert.deepEqual(records[0].if, { condition: wish.condition, inputs: [], memoryKeys: ['habit'] })
  assert.deepEqual(records[0].then, { type: 'suggestion', goal: wish.wish, ride: wish.ride })
  assert.equal(records[0].ownerText, ownerText)
  assert.throws(() => store.save({ ...wish, action: { tool: 'didi_submit' } }), /Invalid/)
  store.save({ ...wish, id: entry.id, revision: entry.revision, at: '11:40' })
  assert.throws(() => store.save({ ...wish, id: entry.id, revision: entry.revision }), /changed/)
})

test('a successful routine edit upgrades legacy records and preserves their identities and pause state', t => {
  const store = fixture(t), legacy = join(store.file, '..', 'intent.md')
  const original = { ...wish, wish: wish.wish + '\n<!-- odk-routines-v2\nowner text\n-->',
    id: '11111111-1111-4111-8111-111111111111', revision: 5, enabled: true, ownerText: '保存午间行程' }
  const paused = Array.from({ length: 13 }, (_, index) => ({ ...wish,
    id: '22222222-2222-4222-8222-' + String(index).padStart(12, '0'), revision: 3, enabled: false,
    ownerText: '保留暂停记录\n' + '<!-- -->'.repeat(490),
  }))
  const old = [original, ...paused]
  const legacyText = `# Intents\n\nOwner wishes are data, not instructions or action permission.\n\n${old.map(e => `## ${e.id}\n\n${e.wish}\n\nCondition: ${e.condition}\n\nDaily window: ${e.at}, ${e.timeZone}, ${e.windowMinutes} minutes.\n\nStatus: ${e.enabled ? 'enabled' : 'muted'}; revision ${e.revision}.\n`).join('\n')}\n<!-- odk-intents-v1\n${JSON.stringify(old)}\n-->\n`
  writeFileSync(legacy, legacyText, { mode: 0o600 })
  protectProactivePath(legacy)
  assert.deepEqual(store.list(), old)
  assert.equal(existsSync(store.file), false, 'reading the legacy document does not write a new preference')
  assert.throws(() => store.save({ ...original, revision: 4 }), /changed/)
  const changed = store.save({ ...original, at: '11:45' })
  assert.deepEqual(changed, { ...original, at: '11:45', revision: 6 })
  assert.deepEqual(createIntentStore(store.file).list(), [changed, ...paused])
  assert.equal(readFileSync(legacy, 'utf8'), legacyText)
  assert.throws(() => store.save(original), /changed/)
  const fresh = readFileSync(store.file, 'utf8')
  writeFileSync(store.file, fresh.replace('type: suggestion', 'type: send-mail'))
  assert.throws(() => store.list(), /Invalid|changed/, 'an invalid primary cannot restore the old document')
})

test('ROUTINE.yaml upgrades the previous structured Markdown and uses it before intent.md', t => {
  const store = fixture(t)
  const markdown = join(store.file, '..', 'routines.md')
  const intent = join(store.file, '..', 'intent.md')
  const original = {
    id: '33333333-3333-4333-8333-333333333333', revision: 7, enabled: false,
    ownerText: '保存天气提醒', condition: '气温低于20°C', wish: '散步时带外套',
    timeZone: 'Asia/Shanghai', windowMinutes: 10, memoryKeys: [],
    observations: [{ readingId: 'odk.tile.weather', fields: ['temperatureC'] }],
  }
  const records = [{
    id: original.id, revision: 7, enabled: false, ownerText: original.ownerText,
    when: { type: 'context', timeZone: original.timeZone, windowMinutes: 10 },
    if: { condition: original.condition, observations: original.observations, memoryKeys: [] },
    then: { type: 'suggestion', goal: original.wish },
  }]
  const legacy = `# Routines

## ${original.id}

Paused · Revision 7

### When

Check the current context in \`Asia/Shanghai\`.

### If

> 气温低于20°C

Read \`temperatureC\` from \`odk.tile.weather\` in Open DeskOS Data.

### Then

Offer one next step in Personal Agent.

> 散步时带外套

### Original request

> 保存天气提醒

<!-- odk-routines-v2
${JSON.stringify(records, null, 2)}
-->
`
  writeFileSync(intent, 'Earlier storage is lower priority.', { mode: 0o600 })
  protectProactivePath(intent)
  writeFileSync(markdown, legacy, { mode: 0o600 })
  protectProactivePath(markdown)
  assert.deepEqual(store.list(), [original])
  assert.equal(existsSync(store.file), false)
  const current = store.save({ ...original, enabled: true })
  assert.deepEqual(current, { ...original, revision: 8, enabled: true })
  assert.deepEqual(createIntentStore(store.file).list(), [current])
  assert.equal(parseYaml(readFileSync(store.file, 'utf8')).entries[0].id, original.id)
  assert.equal(readFileSync(markdown, 'utf8'), legacy)
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
  const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
  const { proposalStateStore } = await import('../src/recommendations/index.mjs')
  const store = fixture(t), entry = store.save(wish)
  const checkpoint = proposalStateStore(join(store.file, '..', 'state.json'))
  const events = [], frames = []
  const runtime = createIntentRuntime({ store, memory: async () => ({ notes: { habit: '午间健身' } }), read: async () => null,
    judge: async () => { events.push('condition'); return { status: 'true', model: 'jev-test' } },
    previewRide: async () => { events.push('preview'); return { status: 'quoted', handle: 'real-handle', measuredAt: time, from: [{ handle: 'from-real', name: '测试起点', city: '测试市', address: '', location: { lng: 1, lat: 2 } }], to: [{ handle: 'to-real', name: '测试终点', city: '测试市', address: '', location: { lng: 1, lat: 2 } }], items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }], expiresAt: Date.parse(time) + 120000 } }, now: () => Date.parse(time) })
  const options = { config: { version: 2, pollMs: 60000, maxAgeMs: 300000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }, intents: runtime,
    now: () => Date.parse(time), loadState: checkpoint.load, saveState: checkpoint.save, publish: frame => frames.push(frame), save: async () => assert.fail('Intent mute must not modify an owner JSON file'),
    generate: async ({ topics }) => { events.push('generate'); return { suggestions: [{ topicId: topics[0].id, key: 'daily-ride', advice: '查看今天的行程方案。', nextStep: 'Open the referenced source and inspect the pending item.', evidenceIds: topics[0].evidence.map(e => e.id) }] } },
    read: async () => assert.fail('Intent adapter owns its evidence'), execute: async () => assert.fail('Never order'), phrase: async () => assert.fail('Generated flow unchanged') }
  const watch = new ProactiveWatch(options); t.after(() => watch.close())
  await watch.tick(); assert.deepEqual(events, ['condition', 'preview', 'generate'])
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
  const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
  const store = fixture(t); store.save({ ...wish, observations: [{ readingId: 'calendar', fields: ['free'] }] })
  let release, calls = 0, judgments = 0
  const runtime = createIntentRuntime({ store, memory: async () => ({ notes: {} }), now: () => Date.parse(time),
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
  const runtime = createIntentRuntime({ store, memory: async () => ({ notes }), read: async () => null, now: () => clock,
    judge: async () => { judgments++; return { status: 'unknown', model: 'jev-test' } }, previewRide: () => assert.fail('No sufficient evidence') })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), interactionRevision: 0, closed: false }
  await runtime.prepare(watch); await runtime.prepare(watch); assert.equal(judgments, 1)
  notes = { habit: '今天不健身' }; await runtime.prepare(watch); assert.equal(judgments, 2)
  clock += 3600000; await runtime.prepare(watch); assert.equal(judgments, 3)
})

test('Given one memory-referenced Intent, changed actual notes change MCP searches and revoke old route handles', async t => {
  const { fixtureNotes } = await import('./fixtures/mem0.mjs')
  const { createRidePreview } = await import('../src/didi/preview.mjs')
  const store = fixture(t), notes = fixtureNotes(join(store.file, '..', 'legacy-notes.json'))
  const ownerMarkdown = join(store.file, '..', 'MEMORY.md')
  writeFileSync(ownerMarkdown, 'Use a different gym from the one I saved.', { mode: 0o600 })
  protectProactivePath(ownerMarkdown)
  const remember = async (key, value) => { notes.beginTurn(`remember ${key}: ${value}`); await notes.update({ category: key, value }); notes.beginTurn('') }
  await remember('city', '测试市'); await remember('company', '测试办公楼'); await remember('gym', '测试健身馆甲')
  await remember('unrelated', 'Prefer warm tea.')
  const memoryBefore = await notes.read()
  const entry = store.save({ ...wish, condition: '每天提醒', memoryKeys: ['company'], ride: { cityMemoryKey: 'city', fromMemoryKey: 'company', toMemoryKey: 'gym' } })
  const routine = readFileSync(store.file, 'utf8')
  assert.deepEqual(parseYaml(routine).entries[0].if.memoryKeys, ['company'])
  assert.equal(routine.includes('测试办公楼'), false)
  assert.equal(await notes.read(), memoryBefore)
  let clock = Date.parse(time); const searches = []
  const previews = createRidePreview({ now: () => clock, call: async (name, args) => {
    if (name === 'maps_textsearch') { searches.push({ ...args }); return [{ display_name: args.keywords, city: args.city, location: { lng: 1, lat: 2 } }] }
    assert.equal(name, 'taxi_estimate'); return { traceId: 'private-provider-trace', items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] }
  } })
  const runtime = createIntentRuntime({ store, now: () => clock, memory: notes.readNamed, memoryVersion: keys => notes.version(keys), read: async () => null,
    judge: async ({ memory }) => { assert.deepEqual(memory, { city: '测试市', company: '测试办公楼', gym: searches.length ? '测试健身馆乙' : '测试健身馆甲' })
      return { status: 'true', model: 'jev-test' } }, previewRide: previews.search })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), interactionRevision: 0, closed: false }
  await runtime.prepare(watch)
  const old = runtime.details(`intent-${entry.id}`)
  assert.deepEqual(searches, [{ city: '测试市', keywords: '测试办公楼' }, { city: '测试市', keywords: '测试健身馆甲' }])
  await remember('gym', '测试健身馆乙')
  assert.equal(readFileSync(store.file, 'utf8'), routine)
  assert.throws(() => previews.route({ handle: old.handle, from: old.from[0].handle, to: old.to[0].handle }), /changed|expired/)
  clock += 86400000; await runtime.prepare(watch)
  assert.equal(searches.at(-1).keywords, '测试健身馆乙'); assert.equal(store.list()[0].revision, entry.revision)
  assert.equal(JSON.stringify(runtime.details(`intent-${entry.id}`)).includes('private-provider-trace'), false)
})

test('Given an explicit owner route, old Memory cannot replace its named endpoint', async t => {
  const store = fixture(t); store.save({ ...wish, condition: '每天提醒', memoryKeys: [], ride: { city: '测试市', from: '本轮明确起点', to: '本轮明确终点', toMemoryKey: 'gym' } })
  let called = false
  const runtime = createIntentRuntime({ store, now: () => Date.parse(time), memory: async () => ({ notes: { gym: '旧终点' } }), read: async () => null,
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
  const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
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
  const runtime = createIntentRuntime({ store, now: () => clock, memory: async () => ({ notes: { habit: 'Habit data only' }, version: String(memoryRevision) }), memoryVersion: () => String(memoryRevision),
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

test('Timed Intent reports its next window, checks each minute, then skips the missed window', t => {
  const store = fixture(t)
  let clock = Date.parse('2026-11-06T01:15:30Z')
  const { runtime } = host(store, () => assert.fail('nextWake must not judge'), () => assert.fail('nextWake must not discover'), () => clock)
  assert.equal(runtime.nextWake(), Infinity)
  store.save({ ...wish, at: undefined })
  store.save({ ...wish, at: '09:16', enabled: false })
  assert.equal(runtime.nextWake(), Infinity)
  store.save({ ...wish, at: '09:30' })
  assert.equal(runtime.nextWake(), Date.parse('2026-11-06T01:30:00Z'))
  clock = Date.parse('2026-11-06T01:30:35Z')
  assert.equal(runtime.nextWake(), Date.parse('2026-11-06T01:31:00Z'))
  clock = Date.parse('2026-11-06T01:39:00Z')
  assert.equal(runtime.nextWake(), Date.parse('2026-11-06T01:40:00Z'))
  clock = Date.parse('2026-11-06T01:40:00Z')
  assert.equal(runtime.nextWake(), Date.parse('2026-11-07T01:30:00Z'))
})

test('Timed Intent wake follows local time across midnight and clock changes', () => {
  const next = (at, timeZone, from, windowMinutes = 10) => host(
    { list: () => [{ ...wish, enabled: true, at, timeZone, windowMinutes }] },
    () => assert.fail('nextWake must not judge'), () => assert.fail('nextWake must not discover'), () => Date.parse(from),
  ).runtime.nextWake()
  assert.equal(next('23:55', 'Asia/Shanghai', '2026-11-06T16:02:30Z'), Date.parse('2026-11-06T16:03:00Z'))
  assert.equal(next('02:15', 'America/New_York', '2026-03-08T06:50:00Z'), Date.parse('2026-03-09T06:15:00Z'))
  assert.equal(next('02:50', 'America/New_York', '2026-03-08T06:50:00Z', 20), Date.parse('2026-03-08T07:00:00Z'))
  assert.equal(next('01:30', 'America/New_York', '2026-11-01T05:40:00Z'), Date.parse('2026-11-01T06:30:00Z'))
})

test('the default Watch evaluates a timed Intent between heartbeats without a source push', async t => {
  const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
  const { defaultProactiveConfig } = await import('../src/recommendations/index.mjs')
  const clock = Date.parse('2026-11-06T01:15:00Z')
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: clock })
  const store = fixture(t)
  store.save({ ...wish, at: '09:30' })
  let judged = 0
  const { runtime } = host(store, async () => {
    judged++
    return { status: 'false', model: 'jev-test' }
  }, () => assert.fail('False conditions cannot discover a ride'), Date.now)
  const watch = new ProactiveWatch({ config: defaultProactiveConfig(), intents: runtime, now: Date.now, publish() {} })
  t.after(() => watch.close())
  watch.start()
  await watch.inflight
  assert.equal(judged, 0)
  t.mock.timers.tick(15 * 60000)
  await watch.inflight
  assert.equal(judged, 1)
  assert.equal(watch.intentClaims[0].status, 'condition_false')
})

test('a generic saved Intent generates a read-only proposal with the selected Widget evidence', async t => {
  const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
  const { defaultProactiveConfig } = await import('../src/recommendations/index.mjs')
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse(time) })
  const store = fixture(t)
  const readingId = 'odk.tile.weather'
  store.save({ wish: '提醒我带件外套', condition: '天气组件的当前温度低于 20 摄氏度', timeZone: 'Asia/Shanghai',
    windowMinutes: 10, memoryKeys: [], observations: [{ readingId, fields: ['temperatureC'] }] })
  let source = { id: readingId, state: 'live', value: { asOf: '2026-10-17T03:25:00.000Z', temperatureC: 17, place: 'Private fixture place' } }
  const seen = []
  const now = Date.now
  const runtime = createIntentRuntime({
    store, memory: async () => { throw Error('Mem0 worker unavailable') }, now,
    read: async id => { assert.equal(id, readingId); return source },
    judge: async ({ observations }) => {
      assert.deepEqual(observations, [{ id: readingId, state: 'live', measuredAt: '2026-10-17T03:29:00.000Z', values: { temperatureC: 17 } }])
      return { status: 'true', model: 'jev-fixture' }
    },
    previewRide: async () => assert.fail('A generic Intent cannot call a ride provider'),
  })
  const watch = new ProactiveWatch({ config: defaultProactiveConfig(), intents: runtime, now, publish: frame => seen.push(frame),
    generate: async ({ topics }) => {
      const [topic] = topics
      assert.equal(topic.intentCondition, '天气组件的当前温度低于 20 摄氏度')
      const [evidence] = topic.evidence
      assert.deepEqual(topic.evidence.map(({ readingId, field, value, measuredAt }) => [readingId, field, value, measuredAt]),
        [[readingId, 'temperatureC', 17, '2026-10-17T03:29:00.000Z']])
      return { suggestions: [{ topicId: topic.id, key: 'weather', advice: '现在是 17°C，出门时可以带件外套。', nextStep: '准备外套。', evidenceIds: [evidence.id] }] }
    }, execute: async () => assert.fail('A generic Intent cannot execute an action'),
  })
  t.after(() => watch.close())
  watch.start()
  await watch.inflight
  assert.equal(watch.intentClaims[0].status, 'condition_unknown')
  assert.equal(watch.list().length, 0)
  source = { ...source, value: { asOf: '2026-10-17T03:29:00.000Z', place: 'Private fixture place' } }
  await watch.tick()
  assert.equal(watch.intentClaims[0].status, 'condition_unknown')
  assert.equal(watch.list().length, 0)
  source.value.temperatureC = 17
  await watch.tick()
  const [proposal] = watch.list()
  assert.equal(proposal.action, null)
  assert.equal(proposal.confirmation, '')
  assert.equal(proposal.offered, true)
  assert.equal(proposal.evidence[0].readingId, readingId)
  assert.equal(seen.at(-1).popup, true)
  t.mock.timers.tick(180000)
  assert.equal(seen.at(-1).proposals[0].status, 'pending')
  t.mock.timers.tick(1)
  await watch.inflight
  assert.equal(seen.at(-1).proposals[0].status, 'expired')
})


test('a source push skips unrelated generic Intent observations and occurrence claims', async t => {
  const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
  const { defaultProactiveConfig } = await import('../src/recommendations/index.mjs')
  const store = fixture(t)
  const saved = ['a', 'b'].map(readingId => store.save({ wish: 'Show reminder', condition: 'Reading ready',
    timeZone: 'UTC', windowMinutes: 10, memoryKeys: [], observations: [{ readingId, fields: ['ready'] }] }))
  const calls = [], now = () => Date.parse(time)
  const runtime = createIntentRuntime({ store, memory: async () => ({ notes: {} }), now,
    read: async id => { calls.push(id); return { id, state: 'live', value: { ready: false, asOf: time } } },
    judge: async () => ({ status: 'false', model: 'jev-fixture' }) })
  const watch = new ProactiveWatch({ config: defaultProactiveConfig(), intents: runtime, now, publish() {} })
  t.after(() => watch.close())
  await watch.tick({ kind: 'service_push', readingIds: ['b'] })
  assert.deepEqual(calls, ['b'])
  assert.deepEqual(watch.intentClaims.map(claim => claim.intentId), [saved[1].id])
})

test('a fresh Hydra snapshot cannot revive stale soil and fresh evidence keeps the plant timestamp', async t => {
  const { ProactiveWatch, defaultProactiveConfig } = await import('../src/recommendations/index.mjs')
  const store = fixture(t)
  const readingId = 'odk.tile.hydra'
  const field = 'plants.0.soilPercent'
  store.save({ wish: 'Check the surface soil', condition: 'Soil moisture is low',
    timeZone: 'UTC', windowMinutes: 10, memoryKeys: [], observations: [{ readingId, fields: [field] }] })
  const measuredAt = new Date(Date.parse(time) - 15000).toISOString()
  const plant = { soilPercent: 14, online: true, soilStale: true, measuredAt }
  const read = async () => ({ id: readingId, state: 'live', value: { plants: [plant], asOf: time } })
  let judgments = 0
  const now = () => Date.parse(time)
  const runtime = createIntentRuntime({ store, read, memory: async () => ({ notes: {} }), now,
    judge: async () => { judgments++; return { status: 'true', model: 'fixture/condition' } } })
  const watch = new ProactiveWatch({ config: defaultProactiveConfig(), intents: runtime, read, now, publish() {},
    generate: async ({ topics: [topic] }) => ({ suggestions: [{ topicId: topic.id, key: 'soil', advice: 'The soil is dry.',
      nextStep: 'Check the surface soil.', evidenceIds: [topic.evidence[0].id] }] }) })
  t.after(() => watch.close())
  await watch.tick()
  assert.equal(judgments, 0)
  assert.deepEqual(watch.list(), [])
  plant.soilStale = false
  await watch.tick({ kind: 'service_push', readingIds: [readingId] })
  assert.equal(judgments, 1)
  const [first] = watch.list()
  assert.equal(first.evidence[0].measuredAt, measuredAt)
  await watch.presented([first.id])
  plant.measuredAt = time
  assert.equal(watch.push([readingId]), true)
  await watch.tick({ kind: 'service_push', readingIds: [readingId] })
  assert.equal(judgments, 1)
  const [refreshed] = watch.list()
  assert.equal(refreshed.id, first.id)
  assert.equal(refreshed.status, 'pending')
  assert.equal(refreshed.presented, true)
  assert.equal(refreshed.evidence[0].measuredAt, time)
  plant.soilPercent = 37
  assert.equal(watch.push([readingId]), true)
  await watch.tick({ kind: 'service_push', readingIds: [readingId] })
  assert.equal(watch.list()[0].status, 'expired')
})

test('an installed Widget uses the host publication time for a field without its own clock', async t => {
  const { ProactiveWatch, defaultProactiveConfig } = await import('../src/recommendations/index.mjs')
  const store = fixture(t)
  const readingId = 'test.app'
  store.save({ wish: 'Check pending items', condition: 'At least one item is pending',
    timeZone: 'UTC', windowMinutes: 10, memoryKeys: [], observations: [{ readingId, fields: ['pending'] }] })
  const now = () => Date.parse(time)
  const read = async () => ({ id: readingId, kind: 'package', state: 'live', updatedAt: now(), value: { pending: true } })
  const runtime = createIntentRuntime({ store, read, memory: async () => ({ notes: {} }), now,
    judge: async () => ({ status: 'true', model: 'fixture/condition' }) })
  const watch = new ProactiveWatch({ config: defaultProactiveConfig(), intents: runtime, read, now, publish() {},
    generate: async ({ topics: [topic] }) => ({ suggestions: [{ topicId: topic.id, key: 'pending', advice: 'An item is pending.',
      nextStep: 'Check the item.', evidenceIds: [topic.evidence[0].id] }] }) })
  t.after(() => watch.close())
  await watch.tick()
  assert.equal(watch.list()[0]?.evidence[0].measuredAt, time)
})

for (const decision of ['ignore', 'mute']) {
  test(`a sourced read-only Intent ${decision} survives checkpoint and Intent-store reload`, async t => {
    const { ProactiveWatch } = await import('../src/recommendations/index.mjs')
    const { defaultProactiveConfig } = await import('../src/recommendations/index.mjs')
    const { proposalStateStore } = await import('../src/recommendations/index.mjs')
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse(time) })
    const store = fixture(t)
    const selected = store.save({ wish: 'Consider a jacket for a walk', condition: 'The selected current temperature is below twenty degrees',
      timeZone: 'Asia/Shanghai', windowMinutes: 10, memoryKeys: [], observations: [{ readingId: 'odk.tile.weather', fields: ['temperatureC'] }] })
    const unrelated = store.save({ ...wish, at: '20:00' })
    const checkpoint = proposalStateStore(join(store.file, '..', 'proposals.json'))
    const calls = { read: 0, condition: 0, generation: 0 }
    function boot(currentStore) {
      const runtime = createIntentRuntime({ store: currentStore, memory: async () => ({ notes: {} }), now: Date.now,
        read: async id => {
          calls.read++
          assert.equal(id, 'odk.tile.weather')
          return { id, state: 'live', value: { asOf: new Date().toISOString(), temperatureC: 17 } }
        },
        judge: async () => { calls.condition++; return { status: 'true', model: 'fixture/condition' } },
        previewRide: async () => assert.fail('Sourced Intent feedback cannot discover a ride'),
      })
      const watch = new ProactiveWatch({ config: defaultProactiveConfig(), intents: runtime, now: Date.now,
        loadState: checkpoint.load, saveState: checkpoint.save, publish() {},
        save: async () => assert.fail('Intent feedback cannot write an owner rule file'),
        execute: async () => assert.fail('Read-only Intent feedback cannot execute an action'),
        generate: async ({ topics }) => {
          calls.generation++
          assert.equal(topics.length, 1)
          const [topic] = topics
          return { suggestions: [{ topicId: topic.id, key: 'walk-jacket', advice: 'Consider bringing a jacket for a walk.',
            nextStep: 'Prepare a jacket before leaving.', evidenceIds: topic.evidence.map(evidence => evidence.id) }] }
        },
      })
      t.after(() => watch.close())
      watch.start()
      return watch
    }
    const watch = boot(store)
    await watch.inflight
    const [proposal] = watch.list()
    assert.equal(proposal.ruleId, `intent-${selected.id}`)
    assert.equal(proposal.action, null)
    assert.equal(proposal.confirmation, '')
    assert.equal(proposal.offered, true)
    await watch.presented([proposal.id])
    await watch.respond(proposal.id, decision)
    assert.equal(watch.list()[0].status, 'ignored')
    assert.equal(checkpoint.load().proposals[0].id, proposal.id)
    assert.equal(checkpoint.load().proposals[0].status, 'ignored')
    const saved = createIntentStore(store.file).list()
    assert.equal(saved.find(entry => entry.id === selected.id).enabled, decision === 'ignore')
    assert.equal(saved.find(entry => entry.id === unrelated.id).enabled, true)
    assert.equal(saved.find(entry => entry.id === selected.id).revision, decision === 'mute' ? selected.revision + 1 : selected.revision)
    await watch.tick()
    assert.equal(calls.generation, 1)
    await watch.close()
    const afterStop = { ...calls }
    t.mock.timers.tick(60000)
    await watch.tick()
    assert.deepEqual(calls, afterStop, 'A stopped Watch cannot regenerate or read sources')

    const restarted = boot(createIntentStore(store.file))
    await restarted.inflight
    await restarted.tick()
    assert.equal(restarted.list().filter(proposal => proposal.status === 'pending').length, 0)
    assert.equal(restarted.list().find(item => item.id === proposal.id).status, 'ignored')
    assert.equal(calls.generation, 1, 'Restart cannot regenerate a handled sourced occurrence')
    assert.equal(calls.condition, 1, 'Restart cannot rediscover the handled Intent occurrence')
    await restarted.close()
    const afterRestartStop = { ...calls }
    t.mock.timers.tick(30 * 60000)
    await restarted.tick()
    assert.deepEqual(calls, afterRestartStop)
  })
}

test('A weekday Gmail routine stores its schedule and verified label separately from its condition', t => {
  const store = fixture(t)
  const schedule = { days: 'weekdays', start: '09:00', end: '18:00', everyMinutes: 15 }
  const gmail = { label: '工作', labelId: 'Label_42', accountKey: 'a'.repeat(64), historyId: '9001', since: Date.parse(time) }
  const entry = store.save({ wish: '提醒一次，并给一个下一步', condition: '新邮件需要我处理',
    ownerText: '工作日 9:00–18:00，每 15 分钟检查一次 Gmail「工作」标签', timeZone: 'Asia/Shanghai',
    windowMinutes: 10, observations: [], memoryKeys: [], schedule, gmail })
  const saved = parseYaml(readFileSync(store.file, 'utf8')).entries[0]
  assert.deepEqual(saved.when, { type: 'interval-window', timeZone: 'Asia/Shanghai', ...schedule })
  const { label, ...binding } = gmail
  assert.deepEqual(saved.if.inputs, [{ type: 'service', connectorId: 'gmail', selection: { type: 'label', name: label }, binding }])
  assert.deepEqual(store.list(), [entry])
  assert.throws(() => store.save({ ...entry, schedule: { ...schedule, end: '08:59' } }), /Invalid/)
})

test('The shared interval trigger checks a DeskOS input once per slot and suggests once per local day', async t => {
  const store = fixture(t)
  const readingId = 'odk.tile.weather'
  const schedule = { days: 'daily', start: '09:00', end: '09:30', everyMinutes: 15 }
  const entry = store.save({ wish: 'Bring a jacket', condition: 'Daily low is below 22 °C', timeZone: 'Asia/Shanghai',
    windowMinutes: 10, memoryKeys: [], observations: [{ readingId, fields: ['lowC'] }], schedule })
  const document = parseYaml(readFileSync(store.file, 'utf8'))
  assert.equal(document.version, 2)
  assert.deepEqual(document.entries[0].when, { type: 'interval-window', timeZone: 'Asia/Shanghai', ...schedule })
  assert.deepEqual(document.entries[0].if.inputs, [{ type: 'odk-data', readingId, fields: ['lowC'] }])
  assert.deepEqual(store.list(), [entry])
  const start = Date.parse('2026-11-08T09:00:00+08:00')
  let clock = start - 1000, value = 25, reads = 0, checks = 0
  const runtime = createIntentRuntime({ store, now: () => clock, memory: async () => ({ notes: {} }),
    read: async id => { reads++; return { id, state: 'live', value: { lowC: value, asOf: new Date(clock).toISOString() } } },
    judge: async () => { checks++; return { model: 'jev-test', status: value < 22 ? 'true' : 'false' } } })
  const watch = { intentClaims: [], persist() {}, controller: new AbortController(), closed: false, interactionRevision: 0 }
  assert.equal(runtime.nextWake(), start)
  await runtime.prepare(watch, { timedOnly: true })
  assert.equal(reads, 0)
  clock = start
  await runtime.prepare(watch, { timedOnly: true })
  assert.equal(checks, 1)
  assert.equal(runtime.nextWake(), start + 15 * 60000)
  value = 14
  clock = start + 60000
  await runtime.prepare(watch, { readingIds: [readingId] })
  await runtime.prepare(watch)
  assert.equal(reads, 1)
  assert.deepEqual(runtime.rules(), [])
  clock = start + 15 * 60000
  await runtime.prepare(watch, { timedOnly: true })
  assert.equal(checks, 2)
  assert.equal(runtime.rules({ timedOnly: true }).length, 1)
  assert.equal(watch.intentClaims.length, 1)
  assert.equal(watch.intentClaims[0].checkSlot, '2026-11-08:0555')
  await runtime.prepare(watch, { timedOnly: true })
  assert.equal(checks, 2)
  clock = start + 30 * 60000
  await runtime.prepare(watch, { timedOnly: true })
  assert.deepEqual(runtime.rules(), [])
})

for (const format of ['JSON', 'YAML']) test(`ROUTINE.yaml upgrades version 1 ${format} without changing Gmail routine identity or scope`, t => {
  const store = fixture(t)
  const legacy = format === 'JSON' ? join(store.file, '..', 'routine.json') : store.file
  if (format === 'JSON') assert.equal(createIntentStore(legacy).file, store.file)
  const id = '44444444-4444-4444-8444-444444444444'
  const schedule = { days: 'weekdays', start: '09:00', end: '18:00', everyMinutes: 15 }
  const gmail = { label: '工作', labelId: 'Label_42', accountKey: 'a'.repeat(64), historyId: '9001', since: Date.parse(time) }
  const ownerText = '工作日检查 Gmail：工作\n\n匹配时给一个下一步。\n'
  const legacyEntry = {
    id, revision: 7, enabled: false, ownerText,
    when: { type: 'interval-window', timeZone: 'Asia/Shanghai', ...schedule },
    if: { condition: '新邮件需要我处理', observations: [], memoryKeys: [], gmail },
    then: { type: 'suggestion', goal: '提醒一次，并给一个下一步' },
  }
  const document = { version: 1, entries: [legacyEntry] }
  const original = format === 'JSON' ? JSON.stringify(document, null, 2) + '\n'
    : stringifyYaml(document, { lineWidth: 0, aliasDuplicateObjects: false })
  writeFileSync(legacy, original, { mode: 0o600 })
  protectProactivePath(legacy)
  const [restored] = store.list()
  assert.equal(restored.id, id)
  assert.equal(restored.revision, 7)
  assert.equal(restored.enabled, false)
  assert.deepEqual(restored.gmail, gmail)
  assert.deepEqual(restored.schedule, schedule)
  assert.equal(existsSync(store.file), format === 'YAML')
  assert.equal(readFileSync(legacy, 'utf8'), original)
  const edited = store.save({ ...restored, wish: '给一个可做的下一步',
    schedule: { everyMinutes: 15, end: '18:00', start: '09:00', days: 'weekdays' } })
  assert.deepEqual(edited, { ...restored, revision: 8, wish: '给一个可做的下一步' })
  const yaml = readFileSync(store.file, 'utf8')
  assert.match(yaml, /^version: 2\nentries:\n/)
  if (format === 'JSON') assert.equal(readFileSync(legacy, 'utf8'), original)
  assert.deepEqual(createIntentStore(store.file).list(), [edited])
  writeFileSync(store.file, yaml.replace('version: 2', 'version: 2\nversion: 2'))
  assert.throws(() => store.list(), /Invalid|changed/, 'an invalid YAML file cannot restore a stale legacy routine')
})
