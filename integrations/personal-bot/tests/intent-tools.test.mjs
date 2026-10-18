import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createIntentStore, createIntentRuntime } from '../src/intents.mjs'
import { createIntentTools } from '../src/intent-tools.mjs'
import { createIntentJudge } from '../src/intent-jev.mjs'
import { guardIntentTools } from '../src/intent-routing.mjs'
import { validateAgentPlugins } from '../src/agent-plugins/selection.mjs'
import { protectProactivePath } from '../src/proactive-private.mjs'
const candidate = { wish: '每天查看行程', condition: '每天提醒', at: '11:30', memoryKeys: [], observations: [] }
function fixture(t, authorize = async () => true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-intent-tools-'))); protectProactivePath(dir)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = createIntentStore(join(dir, 'intent.md')), runtime = createIntentRuntime({ store, memory: async () => ({}), read: async () => null, judge: async () => null, previewRide: undefined })
  let owner = { text: '每天十一点半提醒我查看行程', intent: 'intent_manage', turn: 1 }
  const tools = createIntentTools({ runtime, judge: { authorize }, currentTurn: () => owner, getWatch: () => undefined, memory: async () => ({}) })
  return { store, tools, change: next => { owner = next } }
}
test('Given no explicit plugin selection or another workflow, Intent cannot be enabled by role text', async t => {
  assert.throws(() => validateAgentPlugins({ enabled: ['arbitrary-intent-plugin'] }))
  assert.deepEqual(validateAgentPlugins({ enabled: ['intent'] }).enabled, ['intent'])
  const f = fixture(t), guarded = guardIntentTools(f.tools, () => 'conversation')
  await assert.rejects(guarded.find(t => t.name === 'intent_save').execute('call', candidate), /unavailable/)
  assert.equal(f.store.list().length, 0)
})
test('Given a Jev-routed current owner, the tool saves language with host defaults and preserves mute during edits', async t => {
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
