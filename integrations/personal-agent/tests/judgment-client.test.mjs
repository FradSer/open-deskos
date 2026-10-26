import {createJudgmentClient} from './helpers/isolated-provider.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import { createOptionalJevHealthCheck, isJudgmentModel, validateJudgmentAnswers, validateOrdinaryJudgmentAnswers } from '../src/judgment-client.mjs'

const questions = {intent: {type: 'choice', criteria: {conversation: 'A conversation', clarify: 'Unclear'}}}
const answers = {intent: {type: 'choice', choice: 'conversation', confidence: 0.95, probabilities: {conversation: 0.95, clarify: 0.05}}}
const compact = {intent: {type: 'choice', choice: 'conversation', confidence: 0.95}}

test('Given no Jev credential, ordinary model judgments remain available without a network attempt', async () => {
  let generated = 0
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', generate: async input => {
    generated++; assert.deepEqual(input.questions, questions); return {answers: compact}
  }})
  const result = await client.request({state: {text: '你好'}, questions})
  assert.equal(result.model, 'fixture/ordinary')
  assert.equal(result.answers.intent.choice, answers.intent.choice)
  assert.equal(result.answers.intent.confidence, answers.intent.confidence)
  assert(Math.abs(result.answers.intent.probabilities.clarify-0.05)<0.000001)
  assert.equal(generated, 1)
  assert.deepEqual(client.status, {status: 'ready', provider: 'model', model: 'fixture/ordinary'})
})

test('Given disabled Jev, classification never constructs its client', async () => {
  let constructed=0
  const client = createJudgmentClient({env: {ODK_JEV_PROVIDER: 'disabled'}, model: () => 'fixture/ordinary',
    createJev: () => { constructed++;throw Error('Must not construct Jev') }, generate: async () => ({answers: compact})})
  assert.equal((await client.request({state: {}, questions})).model, 'fixture/ordinary')
  assert.equal(constructed,0)
})

test('Given failed optional Jev, subsequent judgments use the ordinary model without retrying Jev', async () => {
  let primary = 0; let fallback = 0
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', createJev: () => async () => {primary++; throw Error('Credits unavailable')},
    generate: async () => {fallback++; return {answers: compact}}})
  await client.request({state: {}, questions}); await client.request({state: {}, questions})
  assert.equal(primary, 1); assert.equal(fallback, 2)
  assert.equal(client.status.provider, 'model')
})

test('Given verified Jev, its real model identity is retained without fallback', async () => {
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary',
    createJev: () => async () => ({model: 'jev-1.13-free', answers}), generate: async () => {throw Error('Unexpected fallback')}})
  assert.equal((await client.request({state: {}, questions})).model, 'jev-1.13-free')
  assert.equal(client.status.provider, 'jev')
})

test('Given aborted optional judgment, no fallback or action is started', async () => {
  const controller = new AbortController(); let fallback = 0
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', createJev: () => async () => {controller.abort(); controller.signal.throwIfAborted()},
    generate: async () => {fallback++; return {answers: compact}}})
  await assert.rejects(client.request({state: {}, questions, signal: controller.signal}), {name: 'AbortError'})
  assert.equal(fallback, 0)
})

test('Given invalid ordinary answers, unknown intents and fabricated model identities are rejected', () => {
  assert.equal(validateJudgmentAnswers({answers}, questions).answers.intent.choice, 'conversation')
  for (const value of [{answers: {...answers, extra: {type: 'noul', noul: 1}}}, {model: 'jev-fake', answers},
    {answers: {intent: {...answers.intent, choice: 'execute_anything'}}},
    {answers: {intent: {...answers.intent, probabilities: {conversation: 1, clarify: 1}}}}]) {
    assert.throws(() => validateJudgmentAnswers(value, questions))
  }
  assert.equal(isJudgmentModel('jev-1.13-free'), true)
  assert.equal(isJudgmentModel('opencode/kimi-k3'), true)
  assert.equal(isJudgmentModel('https://user:secret@example.com'), false)
  assert.equal(isJudgmentModel('model'), false)
})

test('Given startup authentication failure, ordinary judgment bypasses the failed optional transport', async () => {
  let primary = 0
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', createJev: () => async () => {primary++; throw Error('Unexpected call')}, generate: async () => ({answers: compact})})
  client.setJevHealth({status: 'unavailable', reason: 'request_rejected'})
  await client.request({state: {}, questions})
  assert.equal(primary, 0)
})

test('Given malformed optional Jev answers, ordinary model judgments still work', async () => {
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary',
    createJev: () => async () => ({model: 'jev-1.13-free', answers: {intent: {type: 'choice', choice: 'arbitrary'}}}),
    generate: async () => ({answers: compact})})
  assert.equal((await client.request({state: {}, questions})).model, 'fixture/ordinary')
})

test('Given an abandoned startup check, its late failure cannot poison a replacement runtime', async () => {
  const controller = new AbortController()
  let finish; let mutations = 0
  let currentAgent = {setJevHealth: () => {mutations++}}
  const check = createOptionalJevHealthCheck({check: async () => new Promise(resolve => {finish = resolve}), getAgent: () => currentAgent})
  const result = check(controller.signal)
  controller.abort()
  currentAgent = {setJevHealth: () => {mutations++}}
  finish({status: 'unavailable'})
  await assert.rejects(result, {name: 'AbortError'})
  assert.equal(mutations, 0)
})

test('Given late failed health after a Jev judgment, readiness immediately selects the ordinary model',async()=>{
 let primary=0,ordinary=0
 const client=createJudgmentClient({env:{},model:()=> 'fixture/ordinary',createJev:()=>async()=>{primary++;return {model:'jev-1.13-free',answers}},generate:async()=>{ordinary++;return {answers: compact}}})
 await client.request({state:{},questions});assert.equal(client.status.provider,'jev')
 client.setJevHealth({status:'unavailable',reason:'rate_limited'})
 assert.deepEqual(client.status,{status:'ready',provider:'model',model:'fixture/ordinary'})
 assert.equal((await client.request({state:{},questions})).model,'fixture/ordinary');assert.equal(primary,1);assert.equal(ordinary,1)
 client.setJevHealth({status:'verified'});assert.equal(client.status.provider,'model','The failed transport remains latched for this runtime')
 let finish
 const pendingClient=createJudgmentClient({env:{},model:()=> 'fixture/ordinary',createJev:()=>()=>new Promise(resolve=>{finish=resolve}),generate:async()=>({answers:compact})})
 const pending=pendingClient.request({state:{},questions})
 pendingClient.setJevHealth({status:'unavailable'})
 finish({model:'jev-1.13-free',answers});assert.equal((await pending).model,'jev-1.13-free','Keep the real result identity for an already started request')
 assert.deepEqual(pendingClient.status,{status:'ready',provider:'model',model:'fixture/ordinary'},'Late Jev success cannot reverse the health latch')
})

test('Given optional Jev response metadata, only validated core answers and real model identity leave the shared client',async()=>{
 const typedQuestions={...questions,check:{type:'noul',instructions:'Check'}}
 const typedAnswers={...answers,check:{type:'noul',noul:0.9}}
 const raw={model:'jev-1.13-free',answers:{intent:{...answers.intent,upstreamExtra:'untrusted'},check:{...typedAnswers.check,confidence:0.8}},usage:{input:1},upstreamExtra:'untrusted'}
 const client=createJudgmentClient({env:{},model:()=> 'fixture/ordinary',createJev:()=>async()=>raw,generate:async()=>{throw Error('Must not fall back for valid core answers')}})
 const result=await client.request({state:{},questions:typedQuestions})
 assert.deepEqual(result,{model:'jev-1.13-free',answers:typedAnswers})
 assert.notEqual(result,raw);assert.deepEqual(raw.answers.check,{type:'noul',noul:0.9,confidence:0.8},'Do not mutate the original transport object')
})

test('Given failed primary and ordinary transports after Jev success, readiness cannot retain the old Jev selection',async()=>{
 let primary=0
 const client=createJudgmentClient({env:{},model:()=> 'fixture/ordinary',createJev:()=>async()=>{
  if(primary++)throw Error('Synthetic primary transport failure')
  return {model:'jev-1.13-free',answers}
 },generate:async()=>{throw Error('Synthetic ordinary transport failure')}})
 await client.request({state:{},questions});assert.equal(client.status.provider,'jev')
 await assert.rejects(client.request({state:{},questions}),/Synthetic ordinary transport failure/)
 assert.deepEqual(client.status,{status:'ready',provider:'model',model:'fixture/ordinary'})
 assert.equal(primary,2)
})

test('Given a compact ordinary choice over many routes, the host supplies a normalized compatibility distribution',async()=>{
 const criteria=Object.fromEntries(Array.from({length:22},(_,i)=>['route'+i,'Synthetic route '+i]))
 const questions={route:{type:'choice',criteria},check:{type:'noul',instructions:'Check'}}
 for(const confidence of [0,0.1,0.79,0.8,0.95,1]) {
  const client=createJudgmentClient({env:{ODK_JEV_PROVIDER:'disabled'},model:()=> 'fixture/ordinary',generate:async()=>({answers:{route:{type:'choice',choice:'route3',confidence},check:{type:'noul',noul:0.91}}})})
  const result=await client.request({state:{},questions}),answer=result.answers.route
  assert.equal(result.model,'fixture/ordinary');assert.equal(answer.choice,'route3');assert.equal(answer.confidence,confidence)
  assert.equal(answer.probabilities.route3,Math.max(confidence,1/22));assert.equal(Object.keys(answer.probabilities).length,22)
  assert(Math.abs(Object.values(answer.probabilities).reduce((a,b)=>a+b,0)-1)<0.001)
  assert.equal(answer.confidence>=0.8&&answer.probabilities.route3>=0.8,confidence>=0.8,'Host compatibility must preserve the dual low-confidence refusal')
  assert.deepEqual(result.answers.check,{type:'noul',noul:0.91})
 }
})

test('Given malformed compact judgments, closed choices and bounded confidence remain mandatory',()=>{
 assert.equal(validateOrdinaryJudgmentAnswers({answers:compact},questions).answers.intent.choice,'conversation')
 for(const value of [{answers}, {answers:{intent:{...compact.intent,choice:'execute_anything'}}},
  {answers:{intent:{...compact.intent,confidence:1.1}}},{answers:{intent:{...compact.intent,confidence:NaN}}},
  {answers:{intent:{...compact.intent,choice:1}}},{answers:{intent:{...compact.intent,extra:'untrusted'}}},
  {answers:{...compact,extra:{type:'noul',noul:1}}},{model:'jev-fake',answers:compact}])assert.throws(()=>validateOrdinaryJudgmentAnswers(value,questions))
})

test('explicit verified reauthentication restores Jev while ordinary health updates never retry it',async()=>{
 let primary=0,ordinary=0
 const client=createJudgmentClient({env:{},model:()=> 'fixture/ordinary',createJev:()=>async()=>{primary++;return {model:'jev-latest',answers}},generate:async()=>{ordinary++;return {answers:compact}}})
 client.setJevHealth({status:'missing_credential'})
 await client.request({state:{},questions});assert.equal(primary,0);assert.equal(ordinary,1)
 client.resetJevHealth({status:'verified'})
 assert.equal((await client.request({state:{},questions})).model,'jev-latest')
 assert.equal(primary,1);assert.equal(ordinary,1);assert.equal(client.status.provider,'jev')
 client.resetJevHealth({status:'missing_credential'})
 await client.request({state:{},questions});assert.equal(primary,1);assert.equal(ordinary,2)
})


import {createIntentTurn, createJevIntentRouter, guardIntentTools} from '../src/intent-routing.mjs'
import {generateWithinDeadline} from '../src/proactive-generation-session.mjs'

const unavailableAnswer = '意图判断暂时不可用，本次请求未执行。请稍后重试。'
function diagnosticTurn(generate, observer, model = () => 'fixture/ordinary') {
  const client = createJudgmentClient({env:{ODK_JEV_PROVIDER:'disabled'}, model, generate})
  const route = createJevIntentRouter({request: client.request})
  const turn = createIntentTurn({route, profile:'personal', tools:['memory_update'], onDiagnostic:observer})
  return {client, turn}
}

test('failed ordinary routing reports one blind diagnostic and cannot dispatch', async () => {
  const events=[], failure=Object.assign(new TypeError('PRIVATE_OWNER_AND_PROVIDER_TEXT'),{code:'ERR_MODULE_NOT_FOUND', privateValue:'PRIVATE_ACCOUNT'})
  const before=Object.getOwnPropertyNames(failure)
  const {turn}=diagnosticTurn(async()=>{throw failure}, event=>events.push(event))
  const result=await turn.prepare('Fixture request')
  assert.equal(result.answer,unavailableAnswer);assert.equal(result.context,undefined);assert.equal(turn.getIntent(),null)
  let executions=0
  const [tool]=guardIntentTools([{name:'memory_update',execute:async()=>{executions++}}],turn.getIntent)
  await assert.rejects(tool.execute('fixture',{}),/unavailable/);assert.equal(executions,0)
  assert.equal(events.length,1);assert.equal(events[0].phase,'model_request')
  assert.equal(events[0].errorName,'TypeError');assert.equal(events[0].errorCode,'ERR_MODULE_NOT_FOUND')
  assert.equal(events[0].cleanup,'not_recorded');assert.equal(events[0].turn,1)
  assert.deepEqual(Object.keys(events[0]).sort(),['attempt','cancelled','cleanup','cleanupErrorCode','cleanupErrorName','errorCode','errorName','phase','timedOut','turn'].sort())
  assert(Object.isFrozen(events[0]));assert(!JSON.stringify(events).includes('PRIVATE_'))
  assert.deepEqual(Object.getOwnPropertyNames(failure),before)
})

test('disabled ordinary routing distinguishes model selection from request failure', async () => {
  const events=[];let calls=0
  const {turn}=diagnosticTurn(async()=>{calls++;return {answers:compact}},event=>events.push(event),()=>undefined)
  assert.equal((await turn.prepare('Fixture request')).answer,unavailableAnswer)
  assert.equal(calls,0);assert.equal(events.length,1);assert.equal(events[0].phase,'model_selection')
})

test('diagnostic observers cannot replace the unavailable answer or leak hostile errors', async () => {
  const hostile=Object.freeze(Object.defineProperties({}, {name:{get(){throw Error('PRIVATE_NAME')}},code:{get(){return 'PRIVATE_CODE'}}}))
  for(const observer of [()=>{throw Error('PRIVATE_OBSERVER')},async()=>{throw Error('PRIVATE_ASYNC_OBSERVER')}]) {
    const {turn}=diagnosticTurn(async()=>{throw hostile},observer)
    assert.equal((await turn.prepare('Fixture request')).answer,unavailableAnswer)
    await new Promise(resolve=>setImmediate(resolve))
  }
  const events=[];const {turn}=diagnosticTurn(async()=>{throw hostile},event=>events.push(event))
  assert.equal((await turn.prepare('Fixture request')).answer,unavailableAnswer)
  assert.equal(events[0].errorName,'other');assert.equal(events[0].errorCode,'other')
  assert(!JSON.stringify(events).includes('PRIVATE_'))
})

test('a valid disabled ordinary judgment emits no failure diagnostics', async () => {
  const events=[];const {turn}=diagnosticTurn(async input=>({answers:Object.fromEntries(Object.keys(input.questions).map(key=>[key,{type:'choice',choice:'conversation',confidence:0.95}]))}),event=>events.push(event))
  const result=await turn.prepare('Fixture greeting')
  assert.equal(turn.getIntent(),'conversation');assert.equal(typeof result.context,'string');assert.deepEqual(events,[])
})

test('concurrent ordinary routing retains each invocation failure phase', async () => {
  const events=[[],[]]
  const generate=({onDiagnostic,...input})=>generateWithinDeadline({onDiagnostic,
    create:async()=>({dispose:async()=>{},abort:async()=>{}}),
    prompt:async(_session,text)=>{await new Promise(resolve=>setImmediate(resolve));if(JSON.parse(text).state.text==='Fixture transport')throw Object.assign(new TypeError('PRIVATE_TRANSPORT'),{code:'ECONNRESET'});return '{invalid'}
  },input)
  const client=createJudgmentClient({env:{ODK_JEV_PROVIDER:'disabled'},model:()=> 'fixture/ordinary',generate})
  const turns=events.map(list=>createIntentTurn({route:createJevIntentRouter({request:client.request}),profile:'personal',tools:['memory_update'],onDiagnostic:event=>list.push(event)}))
  const results=await Promise.all(turns.map((turn,i)=>turn.prepare(i?'Fixture transport':'Fixture parse')))
  assert(results.every(result=>result.answer===unavailableAnswer))
  assert.equal(events[0].length,1);assert.equal(events[1].length,1)
  assert.equal(events[0][0].phase,'parse');assert.equal(events[0][0].errorName,'SyntaxError');assert.equal(events[0][0].attempt,2)
  assert.equal(events[1][0].phase,'prompt');assert.equal(events[1][0].errorCode,'ECONNRESET');assert.equal(events[1][0].attempt,1)
  assert(!JSON.stringify(events).includes('PRIVATE_'))
})


test('a disabled diagnostic observer never reads error accessors', async () => {
  let reads=0;const failure=new Error('PRIVATE_PROVIDER')
  Object.defineProperties(failure,{name:{get(){reads++;return 'PRIVATE_NAME'}},code:{get(){reads++;return 'PRIVATE_CODE'}}})
  const {turn,client}=diagnosticTurn(async()=>{throw failure},undefined)
  assert.equal((await turn.prepare('Fixture request')).answer,unavailableAnswer)
  await assert.rejects(client.request({state:{},questions}),error=>error===failure)
  assert.equal(reads,0)
})


test('a repeated producer observation cannot overwrite the first failure phase', async () => {
  const events=[]
  const {turn}=diagnosticTurn(async({onDiagnostic})=>{
    onDiagnostic({phase:'create',errorName:'TypeError',errorCode:'ECONNRESET',cleanup:'completed',attempt:0})
    onDiagnostic({phase:'dispose',errorName:'PRIVATE_NAME',errorCode:'PRIVATE_CODE',privateValue:'PRIVATE_ACCOUNT'})
    throw Error('PRIVATE_PROVIDER')
  },event=>events.push(event))
  assert.equal((await turn.prepare('Fixture request')).answer,unavailableAnswer)
  assert.equal(events.length,1);assert.equal(events[0].phase,'create');assert.equal(events[0].errorCode,'ECONNRESET')
  assert(!JSON.stringify(events).includes('PRIVATE_'))
})
