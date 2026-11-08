import test from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { ODK_CLIENT_NAME, clientName, openDeskOSClientHeaders, withOpenDeskOSClient } from '../src/model-client-identity.mjs'

const ESCAPED = 'Open\u00c2\u00a0deskOS'

test('every installation names the client without a configured models.json', () => {
  assert.equal(ODK_CLIENT_NAME, 'Open deskOS')
  assert.deepEqual(openDeskOSClientHeaders(), { 'User-Agent': ESCAPED, 'X-Client-Name': ESCAPED })
  assert.equal(openDeskOSClientHeaders()['User-Agent'].includes(' '), false)
})

test('the owner may override the client name from the environment', () => {
  assert.equal(clientName({ ODK_MODEL_CLIENT_NAME: 'Fixture Desk' }), 'Fixture Desk')
  assert.equal(openDeskOSClientHeaders('Fixture Desk')['User-Agent'], 'Fixture\u00c2\u00a0Desk')
  assert.equal(clientName({ ODK_MODEL_CLIENT_NAME: '   ' }), ODK_CLIENT_NAME)
})

test('chat, completion and judgment requests carry the name and keep caller headers', async () => {
  const calls = []
  const runtime = {
    getModel: () => 'model',
    stream: (...args) => { calls.push(['stream', args]); return 'ok' },
    streamSimple: (...args) => { calls.push(['streamSimple', args]) },
    completeSimple: (...args) => { calls.push(['completeSimple', args]) },
    classify: (...args) => { calls.push(['classify', args]) },
  }
  const wrapped = withOpenDeskOSClient(runtime)
  assert.equal(wrapped.getModel(), 'model')
  assert.equal(wrapped.stream({ id: 'm' }, {}, {}), 'ok')
  wrapped.streamSimple({ id: 'm' }, {}, { headers: { 'X-Owner': 'keep' } })
  wrapped.completeSimple({ id: 'm' }, {}, undefined)
  wrapped.classify({ id: 'jev' }, { state: {}, questions: {} }, { maxRetries: 0 })
  assert.equal(calls.length, 4)
  for (const [method, args] of calls) {
    const options = args[2]
    assert.equal(options.headers['User-Agent'], ESCAPED, method)
    assert.equal(options.headers['X-Client-Name'], ESCAPED, method)
  }
  assert.equal(calls[1][1][2].headers['X-Owner'], 'keep')
})

test('a non-object runtime cannot be wrapped', () => {
  assert.throws(() => withOpenDeskOSClient(null), /model runtime is required/)
})

const address = 'testing-owner@example.net'
const phone = '+86 139 0000 1842'
const secret = 'fixture-secret:with-"quotes"'
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
const reply = (content, stopReason = 'stop') => ({ role: 'assistant', content, api: 'openai-completions',
  provider: 'fixture', model: 'fixture', usage, stopReason, timestamp: Date.now() })

test('the model boundary masks transcripts and classifier values without changing local state or provider auth', async () => {
  const chat = { systemPrompt: 'Desk inbox ' + address, messages: [
    { role: 'system', content: 'Private owner profile', sections: { contact: 'Phone: ' + phone } },
    { role: 'user', content: [{ type: 'text', text: address }, { type: 'image', data: 'fixture-image', mimeType: 'image/png' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: { password: secret, to: address } }] },
    { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [
      { type: 'text', text: 'Reply to ' + address }, { type: 'text', text: JSON.stringify({ phone }) },
    ] },
  ] }
  const original = structuredClone(chat)
  const requests = []
  const runtime = withOpenDeskOSClient({
    completeSimple: async (_model, context, options) => {
      requests.push(context)
      assert.equal(options.apiKey, 'provider-auth-fixture')
      assert.deepEqual(context.messages[1].content[1], chat.messages[1].content[1])
      const masked = context.messages[1].content[0].text
      assert.notEqual(masked, address)
      assert.equal(context.messages[2].content[0].arguments.to, masked)
      assert.equal(context.messages[3].content[0].text, 'Reply to ' + masked)
      return reply([{ type: 'text', text: masked }])
    },
    classify: async (_model, context) => {
      requests.push(context)
      assert.equal(context.questions.q.criteria[0], context.state.owner)
      return { stopReason: 'stop', answers: { q: { type: 'choice', choice: context.state.owner, probabilities: { [context.state.owner]: 1 } } } }
    },
  })
  const result = await runtime.completeSimple({}, chat, { apiKey: 'provider-auth-fixture' })
  assert.equal(result.content[0].text, address)
  const { answers } = await runtime.classify({}, { state: { owner: address, phone }, questions: { q: { type: 'choice', criteria: [address, 'Unknown'] } } })
  assert.deepEqual(answers.q, { type: 'choice', choice: address, probabilities: { [address]: 1 } })
  assert.deepEqual(chat, original)
  assert.notEqual(requests[0].messages[1].content[0].text, requests[1].state.owner)
  for (const value of [address, phone, secret]) assert.equal(JSON.stringify(requests).includes(value), false)
})

test('split aliases round-trip through text deltas, tool arguments, and the final stream result', async () => {
  const runtime = withOpenDeskOSClient({ streamSimple: (_model, { messages }) => {
    const alias = messages[0].content
    const password = messages[1].content[0].arguments.password
    assert.notEqual(alias, address)
    assert.notEqual(password, secret)
    const stream = createAssistantMessageEventStream()
    const call = { type: 'toolCall', id: 'c1', name: 'example', arguments: { value: password } }
    const partial = text => reply([{ type: 'text', text }], 'pending')
    stream.push({ type: 'start', partial: partial('') })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: 'To ' + alias.slice(0, 8), partial: partial('To ' + alias.slice(0, 8)) })
    stream.push({ type: 'text_delta', contentIndex: 0, delta: alias.slice(8), partial: partial('To ' + alias) })
    stream.push({ type: 'text_end', contentIndex: 0, content: 'To ' + alias, partial: partial('To ' + alias) })
    stream.push({ type: 'toolcall_delta', contentIndex: 1, delta: '{"value":"' + password.slice(0, 9), partial: partial('To ' + alias) })
    stream.push({ type: 'toolcall_delta', contentIndex: 1, delta: password.slice(9) + '"}', partial: partial('To ' + alias) })
    stream.push({ type: 'toolcall_end', contentIndex: 1, toolCall: call, partial: reply([{ type: 'text', text: 'To ' + alias }, call], 'pending') })
    stream.push({ type: 'done', reason: 'toolUse', message: reply([{ type: 'text', text: 'To ' + alias + ' {{ODK_UNKNOWN}}' }, call], 'toolUse') })
    return stream
  } })
  const stream = runtime.streamSimple({}, { messages: [
    { role: 'user', content: address },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'c0', name: 'previous', arguments: { password: secret } }] },
  ] })
  const events = await Array.fromAsync(stream)
  const deltas = type => events.filter(event => event.type === type).map(event => event.delta).join('')
  assert.equal(deltas('text_delta'), 'To ' + address)
  assert.equal(events.find(event => event.type === 'text_delta').partial.content[0].text, 'To ')
  assert.deepEqual(JSON.parse(deltas('toolcall_delta')), { value: secret })
  assert.deepEqual(events.find(event => event.type === 'toolcall_end').toolCall.arguments, { value: secret })
  const result = await stream.result()
  assert.equal(result.content[0].text, 'To ' + address + ' {{ODK_UNKNOWN}}')
  assert.deepEqual(result.content[1].arguments, { value: secret })
})

test('a context the privacy layer cannot process never reaches the provider', () => {
  const runtime = withOpenDeskOSClient({ classify: () => assert.fail('Provider was called') })
  const state = {}
  Object.defineProperty(state, 'owner', { enumerable: true, get() { throw Error(address) } })
  assert.throws(() => runtime.classify({}, { state, questions: {} }), {
    message: 'The model privacy layer could not mask the request.',
  })
})
