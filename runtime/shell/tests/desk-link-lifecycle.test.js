'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createDeskLinkClient } = require('../src/desk-link-client')
const { createPiSessionEventsSource } = require('../src/pi-session-events-source')
const { posixOnlyReason } = require('./not-ported')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function fixture(t, count = 1, respondMachines = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-desk-link-stop-'))
  const endpoint = path.join(root, 'link.sock')
  const requests = []
  const sockets = new Set()
  const ready = deferred()
  const closed = deferred()
  let closures = 0
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => { sockets.delete(socket); if (++closures === count) closed.resolve() })
    let pending = ''
    socket.on('data', chunk => {
      pending += chunk.toString()
      if (!pending.includes('\n')) return
      requests.push(JSON.parse(pending.trim()))
      if (respondMachines && requests.at(-1).type === 'machines') socket.end(JSON.stringify({ machines: ['independent'] }) + '\n')
      if (requests.length === count) ready.resolve()
    })
  })
  await new Promise(resolve => server.listen(endpoint, resolve))
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  return { client: createDeskLinkClient({ socketPath: endpoint }), requests, ready: ready.promise, closed: closed.promise }
}

test('Pi Events cancellation closes its native connection and preserves the shared client', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t, 1, true)
  let local = 0
  const read = createPiSessionEventsSource({ deskLink: f.client, readLocal: () => { local++; return { ok: true } } })
  const reading = read({ sessionId: 'fixture', hostedPi: true })
  await f.ready
  await read.stop()
  assert.equal((await reading).ok, false)
  await f.closed
  assert.equal(local, 0)
  assert.deepEqual(f.requests, [{ v: 1, type: 'events', sessionId: 'fixture', hostedPi: true }])
  assert.deepEqual(await f.client.machines(), ['independent'])
  await f.client.stop()
})

test('Desk Link stop drains all native pending request connections', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t, 4)
  const reads = [f.client.snapshot(), f.client.hostedSessions(), f.client.machines(), f.client.sessionEvents('fixture')]
  await f.ready
  await f.client.stop()
  const values = await Promise.all(reads)
  assert.equal(values[0].ok, false)
  assert.equal(values[1].ok, false)
  assert.deepEqual(values[2], [])
  assert.equal(values[3].ok, false)
  await f.closed
  assert.deepEqual(await f.client.machines(), [])
  assert.equal(f.requests.length, 4)
})

test('per-request cancellation does not cancel an independent request', async () => {
  const gates = [deferred(), deferred()]
  const signals = []
  const client = createDeskLinkClient({ socketPath: '/fixture/link.sock', send: async (_endpoint, _record, _timeout, channel) => {
    signals.push(channel.signal)
    return gates[signals.length - 1].promise
  } })
  const controller = new AbortController()
  const first = client.machines({ signal: controller.signal })
  const second = client.machines()
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  assert.equal(signals[0]?.aborted, true)
  assert.equal(signals[1]?.aborted, false)
  gates[0].resolve({ machines: ['late'] })
  gates[1].resolve({ machines: ['independent'] })
  assert.deepEqual(await first, [])
  assert.deepEqual(await second, ['independent'])
  await client.stop()
})

test('pre-cancelled and stopped Desk Link reads never invoke transport', async () => {
  let sends = 0
  const client = createDeskLinkClient({ socketPath: '/fixture/link.sock', send: async () => { sends++; return { machines: [] } } })
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await client.machines({ signal: controller.signal }), [])
  await client.stop()
  assert.deepEqual(await client.machines(), [])
  assert.equal(sends, 0)
})

test('cancelled transport rejection is unavailable while normal rejection remains visible', async () => {
  for (const cancel of [false, true]) {
    const gate = deferred()
    const ready = deferred()
    const client = createDeskLinkClient({ socketPath: '/fixture/link.sock', send: () => { ready.resolve(); return gate.promise } })
    const controller = new AbortController()
    const reading = client.machines({ signal: controller.signal })
    await ready.promise
    if (cancel) controller.abort()
    gate.reject(Error('fixture'))
    if (cancel) assert.deepEqual(await reading, [])
    else await assert.rejects(reading, /fixture/)
    await client.stop()
  }
})
