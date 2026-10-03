'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const { readOrCreateToken } = require('../src/local-channel')
const { createServicePluginSocket } = require('../src/service-plugin-socket')
const { posixOnlyReason } = require('./not-ported')

const unixHost = process.platform !== 'win32'

async function temporaryDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-plugin-endpoint-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

/** A port nothing is using right now, so a test can state one explicitly. */
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** One plugin connection: optional handshake, then the records it would push. */
// `hold` keeps the plugin's connection open, because a connection that closes is
// a reading that stops being live; the caller destroys the returned socket.
function push(endpoint, records, { token, hold = false } = {}) {
  const target = endpoint.startsWith('tcp://')
    ? (() => { const [host, port] = endpoint.slice('tcp://'.length).split(':'); return { host, port: Number.parseInt(port, 10) } })()
    : endpoint
  return new Promise((resolve, reject) => {
    const socket = net.connect(target)
    socket.setTimeout(3000)
    socket.on('connect', () => {
      if (token !== undefined) socket.write(`${JSON.stringify({ v: 1, token })}\n`)
      for (const record of records) socket.write(`${JSON.stringify(record)}\n`)
      setTimeout(() => { if (hold) resolve(socket); else { socket.end(); resolve() } }, 250)
    })
    socket.on('timeout', () => { socket.destroy(); resolve() })
    socket.on('error', reject)
  })
}

function collect() {
  const snapshots = []
  const rejections = []
  return {
    snapshots,
    rejections,
    onSnapshot: (record) => snapshots.push(record),
    onReject: (reason) => rejections.push(reason),
  }
}

const HELLO = { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 }
const DATA = { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [{ code: 'HK.00700' }], totals: {} }, updatedAt: Date.now() }

test('a tcp endpoint accepts a plugin that presents the channel token', async (t) => {
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const endpoint = `tcp://127.0.0.1:${await freePort()}`
  const sink = collect()
  const server = createServicePluginSocket({
    endpoint,
    channelToken: token,
    services: { 'futu-poller': { revision: 'r1' } },
    onSnapshot: sink.onSnapshot,
    onStatus: () => {},
  })
  await server.start()
  t.after(() => server.stop())

  await push(endpoint, [HELLO, DATA], { token })
  await new Promise((resolve) => setTimeout(resolve, 150))

  assert.deepEqual(sink.rejections, [])
  // The hello is answered with a status and an ack; only the data record becomes a snapshot.
  assert.equal(sink.snapshots.length, 1)
  assert.equal(sink.snapshots[0]?.snapshot.positions[0].code, 'HK.00700')
})

test('a tcp endpoint refuses a plugin that presents no token or the wrong one', async (t) => {
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const endpoint = `tcp://127.0.0.1:${await freePort()}`
  const sink = collect()
  const server = createServicePluginSocket({
    endpoint,
    channelToken: token,
    services: { 'futu-poller': { revision: 'r1' } },
    onSnapshot: sink.onSnapshot,
    onReject: sink.onReject,
    onStatus: () => {},
  })
  await server.start()
  t.after(() => server.stop())

  await push(endpoint, [HELLO, DATA])
  await push(endpoint, [HELLO, DATA], { token: 'not-the-token' })
  await new Promise((resolve) => setTimeout(resolve, 150))

  assert.deepEqual(sink.snapshots, [], 'a plugin that cannot prove the token never reaches the protocol')
  assert.equal(sink.rejections.length, 2)
  assert.ok(sink.rejections.every((reason) => reason.includes('token')))
})

test('a tcp endpoint that is already bound is refused rather than taken over', async (t) => {
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const endpoint = `tcp://127.0.0.1:${await freePort()}`
  const options = { endpoint, channelToken: token, services: { 'futu-poller': { revision: 'r1' } }, onSnapshot: () => {} }
  const first = createServicePluginSocket(options)
  await first.start()
  t.after(() => first.stop())

  const second = createServicePluginSocket(options)
  await assert.rejects(second.start(), /in use|listening/i)
})

test('a socket endpoint still accepts the plugin that predates the token', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const endpoint = path.join(dir, 'open-deskos', 'futu-poller.sock')
  const sink = collect()
  const server = createServicePluginSocket({
    endpoint,
    channelToken: token,
    services: { 'futu-poller': { revision: 'r1' } },
    onSnapshot: sink.onSnapshot,
    onStatus: () => {},
  })
  await server.start()
  t.after(() => server.stop())

  // The reference host's running poller sends no handshake: ownership is what
  // authenticates it there, and that must not change.
  await push(endpoint, [HELLO, DATA])
  await new Promise((resolve) => setTimeout(resolve, 150))

  assert.equal(sink.snapshots.some((record) => record.snapshot), true)
})

test('a socket endpoint is created private, unlike the world-readable socket it replaces', { skip: posixOnlyReason('posix-modes') }, async (t) => {
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const endpoint = path.join(dir, 'open-deskos', 'futu-poller.sock')
  const server = createServicePluginSocket({ endpoint, channelToken: token, services: { 'futu-poller': { revision: 'r1' } }, onSnapshot: () => {} })
  await server.start()
  t.after(() => server.stop())

  const socket = await fs.stat(endpoint)
  assert.equal(socket.mode & 0o777, 0o600)
  const directory = await fs.stat(path.dirname(endpoint))
  assert.equal(directory.mode & 0o777, 0o700)
})

test('an endpoint that is not a path, a pipe, or tcp is refused with a reason', async (t) => {
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const server = createServicePluginSocket({ endpoint: 'udp://127.0.0.1:9999', channelToken: token, services: {}, onSnapshot: () => {} })

  await assert.rejects(server.start(), /endpoint/i)
})
test('a declared tcp endpoint carries a plugin snapshot all the way to the source', async (t) => {
  const { createFutuSource } = require('../src/futu-source')
  const dir = await temporaryDir(t)
  const token = await readOrCreateToken({ stateDir: dir })
  const endpoint = `tcp://127.0.0.1:${await freePort()}`
  // Exactly what an installed app declares, so the same app works on either host.
  const source = createFutuSource({
    runtimeDir: '',
    stateDir: dir,
    channelToken: token,
    services: () => ({ 'futu-poller': { revision: 'r1', endpoint } }),
  })
  await source.start()
  t.after(() => source.stop())

  assert.equal(source.snapshot('futu-poller').state, 'syncing')
  const plugin = await push(endpoint, [HELLO, DATA], { token, hold: true })
  await new Promise((resolve) => setTimeout(resolve, 200))

  const snapshot = source.snapshot('futu-poller')
  assert.equal(snapshot.state, 'live')
  assert.equal(snapshot.snapshot.positions[0].code, 'HK.00700')
  plugin.destroy()
})

test('a declared endpoint wins over the historical socket field', () => {
  const { resolveEndpoint } = require('../src/futu-source')

  // What counts as an absolute path is the platform's rule, not this test's.
  const absolute = path.join(path.sep, 'run', 'user', '1000', 'open-deskos', 'futu-poller.sock')
  assert.equal(resolveEndpoint({ endpoint: 'tcp://127.0.0.1:8790', socket: '/run/ignored.sock' }, '/run'), 'tcp://127.0.0.1:8790')
  assert.equal(resolveEndpoint({ socket: absolute }, '/run'), absolute)
  assert.equal(resolveEndpoint({ socket: 'futu-poller.sock' }, path.join(path.sep, 'run', 'open-deskos')), path.join(path.sep, 'run', 'open-deskos', 'futu-poller.sock'))
  assert.equal(resolveEndpoint({ socket: '\\\\.\\pipe\\open-deskos-futu' }, '/run'), '\\\\.\\pipe\\open-deskos-futu')
  assert.equal(resolveEndpoint({}, '/run'), null)
})
