import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createJudgmentClient, createOptionalJevHealthCheck, isJudgmentModel, validateJudgmentAnswers, validateOrdinaryJudgmentAnswers} from '../src/judgment-client.mjs'

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
  const client = createJudgmentClient({env: {ODK_JEV_PROVIDER: 'disabled'}, model: () => 'fixture/ordinary',
    createJev: () => { throw Error('Must not construct Jev') }, generate: async () => ({answers: compact})})
  assert.equal((await client.request({state: {}, questions})).model, 'fixture/ordinary')
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
