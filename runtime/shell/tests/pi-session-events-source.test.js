const test = require('node:test')
const assert = require('node:assert/strict')
const { createPiSessionEventsSource } = require('../src/pi-session-events-source')

for (const reason of ['desk-link-unconfigured', 'desk-link-unavailable', 'session-log-missing']) {
  test(`local result logs remain usable when Desk Link reports ${reason}`, async () => {
    const request = { cwd: '/example/local', sessionId: 'local' }
    const read = createPiSessionEventsSource({
      deskLink: { sessionEvents: async () => ({ ok: false, reason }) },
      readLocal: actual => { assert.deepEqual(actual, request); return { ok: true, events: [{ kind: 'result', text: 'first\nsecond' }] } },
    })
    assert.equal((await read(request)).events[0].text, 'first\nsecond')
  })
}

test('a Hosted Pi event request carries its explicit ownership marker', async () => {
  const calls = []
  const read = createPiSessionEventsSource({
    deskLink: { sessionEvents: async (...args) => { calls.push(args); return { ok: true, events: [] } } },
    readLocal: () => assert.fail('Hosted Pi history stays on the host'),
  })
  await read({ sessionId: 'hosted', cwd: '/example', hostedPi: true })
  assert.deepEqual(calls, [['hosted', { hostedPi: true }]])
})

test('a known reported session without events never falls back to an unrelated local log', async () => {
  const read = createPiSessionEventsSource({
    deskLink: { sessionEvents: async () => ({ ok: false, reason: 'no-reported-events' }) },
    readLocal: () => assert.fail('known reported session is authoritative'),
  })
  assert.equal((await read({ sessionId: 'reported', cwd: '/example' })).reason, 'no-reported-events')
})
