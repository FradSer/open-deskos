import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createIntentStore, createIntentRuntime, ROUTINE_FILENAME } from '../src/recommendations/index.mjs'
import { createIntentTools } from '../src/intent-tools.mjs'
import { createIntentJudge } from '../src/intent-jev.mjs'
import { guardIntentTools } from '../src/intent-routing.mjs'
import { validateAgentPlugins } from '../src/agent-plugins/selection.mjs'
import { protectProactivePath } from '../src/proactive-private.mjs'
const candidate = { wish: '每天查看行程', condition: '每天提醒', at: '11:30', memoryKeys: [], observations: [] }
function fixture(t, authorize = async () => true, read = async () => null, getWatch = () => undefined, memory = async () => {
  throw Error('Mem0 worker unavailable')
}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-intent-tools-'))); protectProactivePath(dir)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createIntentStore(join(dir, ROUTINE_FILENAME)), runtime = createIntentRuntime({ store, memory, read, judge: async () => null, previewRide: undefined })
  let owner = { text: '每天十一点半提醒我查看行程', intent: 'intent_manage', turn: 1 }
  const tools = createIntentTools({ runtime, judge: { authorize }, currentTurn: () => owner, getWatch })
  return { store, tools, change: next => { owner = next } }
}
test('Given no explicit plugin selection or another workflow, Intent cannot be enabled by role text', async t => {
  assert.throws(() => validateAgentPlugins({ enabled: ['arbitrary-intent-plugin'] }))
  assert.deepEqual(validateAgentPlugins({ enabled: ['intent'] }).enabled, ['intent'])
  const f = fixture(t), guarded = guardIntentTools(f.tools, () => 'conversation')
  await assert.rejects(guarded.find(t => t.name === 'intent_save').execute('call', candidate), /unavailable/)
  assert.equal(f.store.list().length, 0)
})
test('Given an intent-routed current owner, the tool saves language with host defaults and preserves mute during edits', async t => {
  const f = fixture(t), save = f.tools.find(t => t.name === 'intent_save'), mute = f.tools.find(t => t.name === 'intent_mute')
  await save.execute('save', candidate)
  const entry = f.store.list()[0]; assert.equal(entry.timeZone, 'Asia/Shanghai'); assert.equal(entry.windowMinutes, 10)
  await mute.execute('mute', { id: entry.id, revision: entry.revision })
  const muted = f.store.list()[0]
  await save.execute('edit', { ...candidate, id: muted.id, revision: muted.revision, at: '11:40' })
  assert.equal(f.store.list()[0].enabled, false)
})
test('Given a late authorizer response, a different owner turn cannot receive the old write', async t => {
  let resolve
  const f = fixture(t, () => new Promise(r => { resolve = r }))
  const promise = f.tools.find(t => t.name === 'intent_save').execute('save', candidate)
  await new Promise(r => setImmediate(r)); assert.ok(resolve)
  f.change({ text: '忽略上次请求', intent: 'conversation', turn: 2 }); resolve(true)
  await assert.rejects(promise, /current owner turn/); assert.equal(f.store.list().length, 0)
})
test('Given Jev probabilities, sufficient evidence and satisfaction are independent gates with no confidence field', async () => {
  const responses = [[0.1, 0.99, 'unknown'], [0.99, 0.1, 'false'], [0.99, 0.6, 'unknown'], [0.99, 0.99, 'true']]
  for (const [supported, satisfied, expected] of responses) {
    const judge = createIntentJudge({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body.questions), ['supported', 'satisfied'])
      return new Response(JSON.stringify({ model: 'jev-fixture', answers: { supported: { type: 'noul', noul: supported }, satisfied: { type: 'noul', noul: satisfied } } }))
    } })
    assert.equal((await judge.condition({ entry: candidate })).status, expected)
  }
})

test('ordinary typed Intent judgments still require sufficient context and explicit owner authority', async () => {
  const requests=[]
  const judge=createIntentJudge({env:{},request:async input=>{requests.push(input);return {model:'synthetic/model-v1',answers:Object.fromEntries(Object.keys(input.questions).map(key=>[key,{type:'noul',noul:key==='supported'?0.2:0.99}]))}}})
  assert.deepEqual(await judge.condition({entry:candidate,memory:{},observations:[]}),{model:'synthetic/model-v1',status:'unknown'})
  assert.equal(await judge.authorize({ownerText:'Synthetic explicit owner request',candidate}),true)
  assert.equal(requests.length,2);assert.match(requests[0].questions.supported.instructions,/Missing facts/)
})

test('Intent save verifies newly selected desk fields and preserves previous offline bindings on edit', async t => {
  const readingId = 'odk.tile.weather'
  const reads = [], pushes = []
  const watch = { proposals: [], interactionRevision: 0, revision: 0, emit() {}, push: ids => pushes.push(ids) }
  let reading
  const f = fixture(t, async () => true, async id => { reads.push(id); return reading }, () => watch)
  const save = f.tools.find(tool => tool.name === 'intent_save')
  f.change({ text: '天气组件低于20度时提醒我带外套。', intent: 'intent_manage', turn: 2 })
  const input = { wish: '提醒我带外套', condition: '天气组件低于20度', memoryKeys: [], observations: [{ readingId, fields: ['temperatureC'] }] }
  await assert.rejects(save.execute('save', input), /could not verify/)
  assert.equal(f.store.list().length, 0)
  reading = { id: readingId, state: 'live', value: { temperatureC: 17 } }
  await save.execute('save', input)
  const [entry] = f.store.list()
  assert.deepEqual(entry.observations, input.observations)
  reading = null
  await save.execute('edit', { ...input, id: entry.id, revision: entry.revision, condition: '天气组件低于18度' })
  assert.equal(f.store.list()[0].condition, '天气组件低于18度')
  assert.deepEqual(reads, [readingId, readingId])
  assert.deepEqual(pushes, [[readingId], [readingId]])
})

test('Intent save accepts a Widget interval with no Gmail connector', async t => {
  const readingId = 'odk.tile.weather'
  const watch = { proposals: [], interactionRevision: 0, revision: 0, emit() {},
    push: () => assert.fail('The saved interval waits for a scheduled check') }
  const f = fixture(t, async () => true,
    async id => ({ id, state: 'live', value: { lowC: 14 } }), () => watch)
  f.change({ text: '每天九点到十点，每15分钟检查当天最低温，低于22度就建议带外套。', intent: 'intent_manage', turn: 2 })
  const schedule = { days: 'daily', start: '09:00', end: '10:00', everyMinutes: 15 }
  const save = f.tools.find(tool => tool.name === 'intent_save')
  await save.execute('save', { wish: '带件外套', condition: '当天最低温低于22度',
    memoryKeys: [], observations: [{ readingId, fields: ['lowC'] }], schedule })
  const [entry] = f.store.list()
  assert.deepEqual(entry.schedule, schedule)
  assert.equal(entry.gmail, undefined)
})

test('a cancelled Intent save cannot commit after the selected field check returns', async t => {
  const readingId = 'odk.tile.weather'
  const cancellation = new AbortController()
  const f = fixture(t, async () => true, async () => {
    cancellation.abort()
    return { id: readingId, state: 'live', value: { temperatureC: 17 } }
  })
  const save = f.tools.find(tool => tool.name === 'intent_save')
  await assert.rejects(save.execute('save', { ...candidate, observations: [{ readingId, fields: ['temperatureC'] }] }, cancellation.signal), { name: 'AbortError' })
  assert.deepEqual(f.store.list(), [])
})
