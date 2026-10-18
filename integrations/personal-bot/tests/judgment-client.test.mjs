import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createJudgmentClient, isJudgmentModel, validateJudgmentAnswers} from '../src/judgment-client.mjs'

const questions = {intent: {type: 'choice', criteria: {conversation: 'A conversation', clarify: 'Unclear'}}}
const answers = {intent: {type: 'choice', choice: 'conversation', confidence: 0.95, probabilities: {conversation: 0.95, clarify: 0.05}}}

test('Given no Jev credential, ordinary model judgments remain available without a network attempt', async () => {
  let generated = 0
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', generate: async input => {
    generated++; assert.deepEqual(input.questions, questions); return {answers}
  }})
  const result = await client.request({state: {text: '你好'}, questions})
  assert.equal(result.model, 'fixture/ordinary')
  assert.deepEqual(result.answers, answers)
  assert.equal(generated, 1)
  assert.deepEqual(client.status, {status: 'ready', provider: 'model', model: 'fixture/ordinary'})
})

test('Given disabled Jev, classification never constructs its client', async () => {
  const client = createJudgmentClient({env: {ODK_JEV_PROVIDER: 'disabled'}, model: () => 'fixture/ordinary',
    createJev: () => { throw Error('Must not construct Jev') }, generate: async () => ({answers})})
  assert.equal((await client.request({state: {}, questions})).model, 'fixture/ordinary')
})

test('Given failed optional Jev, subsequent judgments use the ordinary model without retrying Jev', async () => {
  let primary = 0; let fallback = 0
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', createJev: () => async () => {primary++; throw Error('Credits unavailable')},
    generate: async () => {fallback++; return {answers}}})
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
    generate: async () => {fallback++; return {answers}}})
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
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary', createJev: () => async () => {primary++; throw Error('Unexpected call')}, generate: async () => ({answers})})
  client.setJevHealth({status: 'unavailable', reason: 'request_rejected'})
  await client.request({state: {}, questions})
  assert.equal(primary, 0)
})

test('Given malformed optional Jev answers, ordinary model judgments still work', async () => {
  const client = createJudgmentClient({env: {}, model: () => 'fixture/ordinary',
    createJev: () => async () => ({model: 'jev-1.13-free', answers: {intent: {type: 'choice', choice: 'arbitrary'}}}),
    generate: async () => ({answers})})
  assert.equal((await client.request({state: {}, questions})).model, 'fixture/ordinary')
})
