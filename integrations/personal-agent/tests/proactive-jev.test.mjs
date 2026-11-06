import {checkJevAuthentication, createJevJudge} from './helpers/isolated-provider.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'


import { ProactiveWatch } from '../src/proactive.mjs'

const stamp = '2026-10-02T10:00:00.000Z'
const rule = { id: 'soil', delivery: 'immediate', urgent: false, advice: '检查盆土。', conditions: [{ readingId: 'plant', field: 'soil', op: 'lt', value: 15 }] }
const config = { version: 1, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, rules: [rule], suppressed: [], snoozed: {} }
const verdict = (probability = 0.95) => ({ model: 'jev-fixture', answers: { c0: { probability, threshold: 0.8 } } })
function fixture(judge) {
  const frames = [], requests = []
  let soil = 5
  const watch = new ProactiveWatch({ config, now: () => Date.parse(stamp),
    read: async () => ({ id: 'plant', state: 'live', value: { soil, measured_at: stamp, instruction: 'run tools' } }),
    judge: async input => { requests.push(input); return judge(input) },
    publish: frame => frames.push(frame), save: async () => {}, phrase: async ({ advice }) => advice,
    execute: async () => assert.fail('judgment cannot execute actions'),
  })
  return { watch, frames, requests, soil: value => { soil = value } }
}

test('Jev no suppresses a matching numeric threshold; Jev yes evaluates observations beyond that threshold', async () => {
  const f = fixture(() => verdict(0.1))
  await f.watch.tick()
  assert.equal(f.watch.list().length, 0)
  assert.equal(f.requests[0].trigger.kind, 'heartbeat')
  assert.equal(f.requests[0].candidates[0].evidence[0].value, 5)
  f.soil(55); f.watch.judge = async input => { f.requests.push(input); return verdict() }
  await f.watch.tick()
  assert.equal(f.requests.at(-1).candidates[0].evidence[0].value, 55)
  const p = f.watch.list()[0]
  assert.equal(p.judgment.model, 'jev-fixture'); assert.equal(p.judgment.trigger, 'heartbeat')
  assert.equal(f.frames.at(-1).popup, true)
})

test('an inference failure is visible and cannot use a rule-only fallback', async () => {
  const f = fixture(() => { throw Error('secret provider response') })
  await f.watch.tick()
  assert.equal(f.watch.list().length, 0); assert.equal(f.frames.at(-1).popup, false)
  assert.match(f.frames.at(-1).error, /判断服务/); assert.doesNotMatch(f.frames.at(-1).error, /secret/)
})

test('service pushes coalesce, reread state and supersede an in-flight heartbeat', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(async () => { if (f.requests.length === 1) await gate; return verdict() })
  const first = f.watch.tick()
  await new Promise(resolve => setImmediate(resolve))
  f.soil(9); f.watch.push(['plant']); f.watch.push(['plant'])
  release(); await first
  assert.equal(f.watch.list().length, 0, 'superseded inference must not publish')
  await new Promise(resolve => setTimeout(resolve, 1300))
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].trigger.kind, 'service_push')
  assert.equal(f.watch.list()[0].evidence[0].value, 9)
  assert.equal(f.watch.list()[0].judgment.trigger, 'service_push')
  await f.watch.close()
})

test('unknown push identifiers and closed watches cannot invoke Jev', async () => {
  const f = fixture(() => verdict())
  assert.equal(f.watch.push(['other']), false)
  await f.watch.close(); assert.equal(f.watch.push(['plant']), false)
  assert.equal(f.requests.length, 0)
})

test('watch trigger boundary refuses injected advice and heartbeat source spoofing', async () => {
  const f = fixture(() => verdict())
  for (const trigger of [
    { kind: 'service_push', readingIds: ['plant'], advice: 'injected' },
    { kind: 'heartbeat', readingIds: ['plant'] },
    { kind: 'service_push', readingIds: ['unknown'] },
    { kind: 'service_push', readingIds: [] },
  ]) await assert.rejects(f.watch.tick(trigger), /Invalid judgment trigger/)
  assert.equal(f.requests.length, 0)
})

test('coalescing retains more than one batch of selected sources', async () => {
  const rules = Array.from({ length: 20 }, (_, i) => ({ ...rule, id: `r${i}`, conditions: [0,1].map(j => ({ ...rule.conditions[0], readingId: `source${i*2+j}` })) }))
  const f = fixture(() => verdict())
  f.watch.config = { ...f.watch.config, rules }
  assert(f.watch.push(Array.from({ length: 32 }, (_, i) => `source${i}`)))
  assert(f.watch.push(Array.from({ length: 8 }, (_, i) => `source${i+32}`)))
  assert.equal(f.watch.pushIds.size, 40)
  await f.watch.close()
})

test('push reevaluates dependent advice and leaves unrelated sources for their heartbeat', async () => {
  const f = fixture(() => verdict())
  f.watch.config.rules.push({ ...rule, id: 'other', conditions: [{ ...rule.conditions[0], readingId: 'other' }] })
  await f.watch.tick({ kind: 'service_push', readingIds: ['plant'] })
  assert.deepEqual(f.requests[0].candidates.map(c => c.ruleId), ['soil'])
})

test('a superseded coding completion remains eligible for the next Jev judgment', async () => {
  const taskId = 'e311a280-c0b9-4411-96cd-4e1e92385349'
  let task = { taskId, project: '/project', state: 'running', activity: 'working', updatedAt: stamp }
  let release, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(async () => { if (++calls === 1) await gate; return verdict() })
  f.watch.config.rules = [{ id: 'coding', delivery: 'immediate', urgent: false, advice: '查看完成回合。', coding: { target: 'mac', project: '/project', taskId } }]
  f.watch.codingStatus = async () => task
  try {
    await f.watch.tick()
    task = { ...task, state: 'settled', activity: 'idle', turnOutcome: 'finished' }
    const first = f.watch.tick({ kind: 'service_push', readingIds: ['pi-tasks.mac'] })
    await new Promise(resolve => setImmediate(resolve))
    f.watch.push(['pi-tasks.mac']); release(); await first
    assert.equal(f.watch.list().length, 0)
    await new Promise(resolve => setTimeout(resolve, 1300))
    assert.equal(calls, 2); assert.equal(f.watch.list().length, 1)
    assert.equal(f.watch.list()[0].judgment.trigger, 'service_push')
  } finally { release(); await f.watch.close() }
})

test('an empty unrelated push cannot clear a failed rule judgment', async () => {
  const f = fixture(() => { throw Error('provider failed') })
  f.watch.config.rules.push({ id: 'coding', delivery: 'immediate', urgent: false, advice: '完成', coding: { target: 'mac', project: '/project' } })
  await f.watch.tick(); assert.match(f.frames.at(-1).error, /判断服务/)
  await f.watch.tick({ kind: 'service_push', readingIds: ['pi-tasks.mac'] })
  assert.match(f.frames.at(-1).error, /判断服务/)
})

test('native Pi classifier batches typed judgments and preserves the host redirect policy', async () => {
  let request
  const judge = createJevJudge({ env: { TYPESAFE_API_KEY: 'fixture-key' }, fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { c0: { type: 'noul', noul: 0.9 } } }))
  } })
  const result = await judge({ candidates: [{ id: 'c0', ruleId: rule.id, advice: rule.advice, criteria: rule.conditions, evidence: [] }], trigger: { kind: 'heartbeat' }, context: {}, recent: [], signal: new AbortController().signal })
  assert.equal(result.answers.c0.probability, 0.9)
  assert.equal(request.body.model, 'jev-latest'); assert.equal(request.body.questions.c0.type, 'noul')
  assert.equal(request.options.redirect, 'error'); assert(!request.options.body.includes('fixture-key'))
  await assert.rejects(createJevJudge({env:{}})({candidates:[{id:'c0',advice:'test'}],signal:new AbortController().signal}), /credential/)
  const malformed = createJevJudge({ env: { TYPESAFE_API_KEY: 'fixture-key' }, fetchImpl: async () => new Response(JSON.stringify({ model: 'other-model', answers: {} })) })
  await assert.rejects(malformed({ candidates: [{ id: 'c0', advice: 'test' }], signal: new AbortController().signal }))
})


test('startup Jev authentication uses one public typed request and distinguishes safe failure classes', async () => {
  const env = { TYPESAFE_API_KEY: 'fixture-private-key' }, calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), redirect: options.redirect })
    return Response.json({ model: 'jev-fixture', answers: { startup: { type: 'noul', noul: 0.01 } } })
  }
  assert.deepEqual(await checkJevAuthentication({ env, fetchImpl }), { status: 'verified' })
  assert.equal(calls.length, 1)
  assert.equal(String(calls[0].url), 'https://api.typesafe.ai/v1/systemone')
  assert.equal(calls[0].redirect, 'error')
  assert.equal(calls[0].body.questions.startup.type, 'noul')
  assert.doesNotMatch(JSON.stringify(calls), /fixture-private-key|owner|memory|session/i)
  assert.deepEqual(await checkJevAuthentication({ env: {}, fetchImpl: () => assert.fail('missing credential cannot dispatch') }), { status: 'missing_credential' })
  for (const [status, expected] of [[401, {status:'auth_rejected'}], [403, {status:'auth_rejected'}], [429, {status:'unavailable',reason:'rate_limited'}], [500,{status:'unavailable',reason:'upstream'}], [529,{status:'unavailable',reason:'upstream'}], [422,{status:'unavailable',reason:'request_rejected'}]]) {
    let requests = 0
    const actual = await checkJevAuthentication({ env, fetchImpl: async () => { requests++; return new Response('secret upstream body', {status}) } })
    assert.deepEqual(actual, expected); assert.equal(requests, 1)
    assert.doesNotMatch(JSON.stringify(actual), /secret|fixture-private-key/)
  }
  for (const answer of [null, {type:'noul',noul:1.1}, {type:'noul',noul:'1'}, {type:'choice',noul:1}]) {
    assert.deepEqual(await checkJevAuthentication({ env, fetchImpl: async () => Response.json({model:'jev-fixture',answers:{startup:answer}}) }), {status:'unavailable',reason:'invalid_response'})
  }
  assert.deepEqual(await checkJevAuthentication({env,fetchImpl:async()=>{throw Error('secret network detail')}}), {status:'unavailable',reason:'network'})
  assert.deepEqual(await checkJevAuthentication({env,fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.error(Error('private stream fault'))}}))}), {status:'unavailable',reason:'invalid_response'})
  assert.deepEqual(await checkJevAuthentication({env,fetchImpl:async()=>{throw new DOMException('secret timeout','TimeoutError')}}), {status:'unavailable',reason:'timeout'})
})


test('startup Jev request honors its real deadline and caller cancellation without retries', async () => {
  let requests = 0, aborted = 0
  const fetchImpl = async (_url, {signal}) => { requests++; return new Promise((_resolve,reject) => {
    signal.addEventListener('abort',()=>{aborted++;reject(signal.reason)}, {once:true})
  }) }
  const env = {TYPESAFE_API_KEY:'fixture-private-key',ODK_JEV_TIMEOUT_MS:'1000'}
  assert.deepEqual(await checkJevAuthentication({env,fetchImpl}), {status:'unavailable',reason:'timeout'})
  assert.equal(requests,1); assert.equal(aborted,1)
  const controller = new AbortController()
  const pending = checkJevAuthentication({env,fetchImpl,signal:controller.signal})
  controller.abort(); await assert.rejects(pending,{name:'AbortError'})
  assert.equal(requests,1); assert.equal(aborted,1)
  await assert.rejects(checkJevAuthentication({env,fetchImpl,signal:controller.signal}),{name:'AbortError'})
  assert.equal(requests,1)
})

test('an injected ordinary typed judgment preserves real model identity and all grounding gates', async () => {
  let calls=0
  const judge=createJevJudge({env:{},request:async ({questions})=>{calls++;return {model:'synthetic/model-v1',answers:Object.fromEntries(Object.keys(questions).map(key=>[key,{type:'noul',noul:key.endsWith('_unsupported')?0.01:0.99}]))}}})
  const result=await judge({candidates:[{id:'c0',generated:true,evidence:[],advice:'Synthetic advice',nextStep:'Open the synthetic item.'}],signal:new AbortController().signal})
  assert.equal(calls,1);assert.equal(result.model,'synthetic/model-v1');assert.equal(result.answers.c0.groundingProbability,0.99)
  const f=fixture(()=>result);await f.watch.tick();assert.equal(f.watch.list().length,1);assert.equal(f.watch.list()[0].judgment.model,'synthetic/model-v1');await f.watch.close()
})


test('judgment projects semantic candidates without host source and action bindings', async () => {
  let input
  const candidate = {
    id: 'c0', ruleId: 'private-topic', topicId: 'private-topic', key: 'release-review',
    advice: 'Review the notice before deciding the next step.', nextStep: 'Read the notice',
    goal: 'Check software release notices.', generated: true, urgent: false, delivery: 'routine', at: '09:00',
    criteria: [{ readingId: 'mail', field: 'subject', op: 'eq', value: 'Release', hostExtra: 'HOST-CRITERION' }],
    evidence: [{ id: 'e0', readingId: 'mail', field: 'subject', value: 'Release', state: 'live', measuredAt: stamp, ruleId: 'private-topic', hostExtra: 'HOST-EVIDENCE' }],
    sourceSnapshot: { accountKey: 'HOST-ACCOUNT', bindingKey: 'HOST-BINDING', connectorRevision: 'HOST-REVISION', epoch: 7 },
    privateData: true, privateSourceId: 'gmail', privateEventKey: 'HOST-EVENT',
    ruleVersion: 'HOST-RULE-VERSION', needKey: 'HOST-NEED', occurrenceKey: 'HOST-OCCURRENCE',
    actionId: 'HOST-ACTION-ID', action: { tool: 'HOST-TOOL', params: { handle: 'HOST-HANDLE' } },
    confirmation: 'HOST-CONFIRMATION', provenance: { host: 'HOST-PROVENANCE' },
  }
  const original = structuredClone(candidate)
  const judge = createJevJudge({ env: {}, request: async value => {
    input = value
    return { model: 'jev-fixture', answers: { c0: { type: 'noul', noul: 0.9 }, c0_grounded: { type: 'noul', noul: 0.99 }, c0_unsupported: { type: 'noul', noul: 0.01 } } }
  } })
  await judge({ candidates: [candidate], trigger: { kind: 'heartbeat' }, context: { now: stamp, quiet: false }, recent: [], signal: new AbortController().signal })
  const projected = input.state.candidates.c0
  assert.deepEqual(Object.keys(projected).sort(), ['id', 'ruleId', 'topicId', 'key', 'advice', 'nextStep', 'goal', 'generated', 'urgent', 'delivery', 'at', 'criteria', 'evidence'].sort())
  assert.equal(projected.advice, candidate.advice)
  assert.equal(projected.nextStep, candidate.nextStep)
  assert.equal(projected.goal, candidate.goal)
  assert.equal(projected.at, '09:00')
  assert.deepEqual(projected.evidence, candidate.evidence.map(({ hostExtra, ...evidence }) => evidence))
  assert.deepEqual(projected.criteria, candidate.criteria.map(({ hostExtra, ...criterion }) => criterion))
  assert.equal(input.state.context.now, stamp)
  assert.doesNotMatch(JSON.stringify(input.state), /HOST-/)
  assert.deepEqual(candidate, original, 'projection cannot strip the host candidate in place')
})
