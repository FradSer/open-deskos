import test from 'node:test'
import assert from 'node:assert/strict'
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
