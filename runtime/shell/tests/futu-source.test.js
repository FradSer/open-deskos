const { notPortedOnWindows } = require("./not-ported")
// A Windows Shell Host does not port this capability; the reference host runs it.
if (notPortedOnWindows(require("node:test").test, "unix-socket")) return

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { createFutuSource } = require('../src/futu-source')

const FEATURE = fs.readFileSync(path.join(__dirname, 'features', 'service-plugin-refresh.feature'), 'utf8')

// The plugin's connection is held open while a test reads, because a connection
// that closes is a reading that stops being live. The caller destroys it.
function sendRecords(sockPath, records) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sockPath, () => {
      for (const record of records) socket.write(`${JSON.stringify(record)}\n`)
      setTimeout(() => resolve(socket), 200)
    })
    socket.on('error', reject)
  })
}

function accepts(sockPath) {
  return new Promise((resolve) => {
    const socket = net.connect(sockPath)
    const done = (value) => { socket.destroy(); resolve(value) }
    socket.setTimeout(1000, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

// The declared socket is either a name under the shell's own runtime directory or the absolute path
// its binder already declared. Both have to land on the same socket, or the tile reports a service
// that is not the one poller.py bound.
test('an absolute declared socket is used as declared, a name resolves under the runtime dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-sock-'))
  const absolute = path.join(elsewhere, 'futu-poller.sock')
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', socket: absolute } }),
  })
  await source.start()
  try {
    assert.equal(source.snapshot('futu-poller').state, 'syncing')
    const plugin = await sendRecords(absolute, [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 },
      { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [], totals: {} }, updatedAt: Date.now() },
    ])
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(source.snapshot('futu-poller').state, 'live')
    } finally {
      plugin.destroy()
    }
    assert.equal(fs.existsSync(path.join(dir, 'futu-poller.sock')), false, 'an absolute path must not also be joined under the runtime dir')
  } finally {
    await source.stop()
  }
})

test('a declared service data record becomes a live snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const updates = []
  const source = createFutuSource({
    onUpdate: id => updates.push(id),
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', socket: 'futu-poller.sock' } }),
  })
  await source.start()
  try {
    assert.equal(source.snapshot('futu-poller').state, 'syncing')
    const plugin = await sendRecords(path.join(dir, 'futu-poller.sock'), [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 },
      { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [], totals: {} }, updatedAt: Date.now() },
    ])
    try {
      await new Promise((resolve) => setTimeout(resolve, 200))
      const reading = source.snapshot('futu-poller')
      assert.equal(reading.state, 'live')
      assert.deepEqual(updates, ['futu-poller'])
      assert.deepEqual(reading.snapshot.positions, [])
    } finally {
      plugin.destroy()
    }
  } finally {
    await source.stop()
  }
})

test('an undeclared service reads unconfigured and auth-required surfaces needs-auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', socket: 'futu-poller.sock' } }),
  })
  await source.start()
  try {
    assert.equal(source.snapshot('unknown').state, 'unconfigured')
    await sendRecords(path.join(dir, 'futu-poller.sock'), [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 },
      { v: 1, type: 'auth-required', service: 'futu-poller', secrets: ['futu-trade-password'] },
    ])
    await new Promise((resolve) => setTimeout(resolve, 200))
    const reading = source.snapshot('futu-poller')
    assert.equal(reading.state, 'needs-auth')
    assert.deepEqual(reading.secrets, ['futu-trade-password'])
  } finally {
    await source.stop()
  }
})

test('BDD feature states the refresh contract of a Service Plugin', () => {
  assert.match(FEATURE, /Feature: A Service Plugin's data keeps arriving for as long as the service does/)
  assert.match(FEATURE, /A service that could not listen is asked again/)
  assert.match(FEATURE, /A declaration that moved is followed/)
  assert.match(FEATURE, /A plugin that went away stops claiming to be live/)
  assert.match(FEATURE, /One desk that dropped does not stop the others/)
})

// A bind that failed is not a running listener, so the periodic refresh has to
// try again. A stale file left at the endpoint is the ordinary way this happens:
// the tile then reads "syncing" for the life of the process, because the only
// refresh is the one that was skipped.
test('a service that could not bind is retried by the next refresh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const endpoint = path.join(dir, 'futu-poller.sock')
  fs.writeFileSync(endpoint, 'left behind by a previous run')
  const refused = []
  const source = createFutuSource({
    runtimeDir: dir,
    onRefuse: (id, reason) => refused.push([id, reason]),
    services: () => ({ 'futu-poller': { revision: 'r1', endpoint } }),
  })
  try {
    // A service that cannot bind is unavailable, not fatal: the shell keeps running.
    await source.start()
    assert.equal(refused.length, 1, 'the reason is stated rather than thrown away')
    assert.equal(refused[0][0], 'futu-poller')
    assert.match(refused[0][1], /not a socket/)

    fs.unlinkSync(endpoint)
    // main.js calls this on its 60s timer, so this is the only recovery there is.
    await source.refreshServices()
    assert.equal(await accepts(endpoint), true, 'the retry must leave the Shell listening')
  } finally {
    await source.stop()
  }
})

// One unusable endpoint is one unavailable service. The other declared service
// still has to answer, or a broken package takes the whole seam down with it.
test('one service that cannot bind does not stop the other from listening', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const blocked = path.join(dir, 'broken.sock')
  const healthy = path.join(dir, 'other.sock')
  fs.writeFileSync(blocked, 'not a socket')
  const refused = []
  const source = createFutuSource({
    runtimeDir: dir,
    onRefuse: (id, reason) => refused.push([id, reason]),
    services: () => ({
      broken: { revision: 'r1', endpoint: blocked },
      'futu-poller': { revision: 'r1', endpoint: healthy },
    }),
  })
  try {
    await source.start()
    assert.equal(await accepts(healthy), true, 'a healthy service must still be listening')
    assert.equal(source.snapshot('futu-poller').state, 'syncing')
    assert.equal(source.snapshot('broken').state, 'syncing')
    assert.deepEqual(refused.map(([id]) => id), ['broken'], 'only the service that failed is reported')
  } finally {
    await source.stop()
  }
})

// A reinstalled package can declare a new endpoint. Keeping the old listener
// answers for a service that no longer exists at that address and leaves the new
// one with nothing listening.
test('a declaration that moved is followed and the old endpoint is withdrawn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const first = path.join(dir, 'first.sock')
  const second = path.join(dir, 'second.sock')
  let endpoint = first
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', endpoint } }),
  })
  try {
    await source.start()
    assert.equal(await accepts(first), true)
    endpoint = second
    await source.refreshServices()
    assert.equal(await accepts(second), true, 'the new endpoint must be listened for')
    assert.equal(await accepts(first), false, 'the replaced endpoint must be released')
  } finally {
    await source.stop()
  }
})

// The shell knows the moment the plugin's connection closes. Reporting the last
// snapshot as live for another freshness window is a number on a desk that no
// longer means anything, and the tile draws live and stale differently.
test('a plugin that dropped is stale, and is live again once it reconnects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const endpoint = path.join(dir, 'futu-poller.sock')
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', endpoint } }),
  })
  const connect = () => new Promise((resolve, reject) => {
    const socket = net.connect(endpoint, () => {
      socket.write(`${JSON.stringify({ v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 })}\n`)
      socket.write(`${JSON.stringify({ v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [], totals: {} }, updatedAt: Date.now() })}\n`)
      resolve(socket)
    })
    socket.on('error', reject)
  })
  try {
    await source.start()
    const first = await connect()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(source.snapshot('futu-poller').state, 'live')

    first.destroy()
    await new Promise((resolve) => setTimeout(resolve, 150))
    const dropped = source.snapshot('futu-poller')
    assert.equal(dropped.state, 'unavailable', 'a closed connection is not a live reading')
    assert.equal(dropped.error, 'plugin disconnected')
    assert.deepEqual(dropped.snapshot.positions, [], 'the last measurement is still there to show dimmed')

    const second = await connect()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(source.snapshot('futu-poller').state, 'live', 'a reconnected plugin is live again')
    second.destroy()
  } finally {
    await source.stop()
  }
})

// Reopening the socket is not a reading. A plugin that reconnects and then goes
// quiet would otherwise put the snapshot from before its outage back on the desk
// as live, which is the same claim the drop removed one moment earlier.
test('a plugin that reconnects without publishing is still not live', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const endpoint = path.join(dir, 'futu-poller.sock')
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', endpoint } }),
  })
  const open = (records) => new Promise((resolve, reject) => {
    const socket = net.connect(endpoint, () => {
      for (const record of records) socket.write(`${JSON.stringify(record)}\n`)
      resolve(socket)
    })
    socket.on('error', reject)
  })
  const HELLO = { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
  try {
    await source.start()
    const publishing = await open([HELLO, { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [], totals: {} }, updatedAt: Date.now() }])
    await settle()
    assert.equal(source.snapshot('futu-poller').state, 'live')

    publishing.destroy()
    await settle()
    assert.equal(source.snapshot('futu-poller').state, 'unavailable')

    const quiet = await open([HELLO])
    await settle()
    const reconnected = source.snapshot('futu-poller')
    assert.equal(reconnected.state, 'unavailable', 'a handshake is not a measurement')
    assert.equal(reconnected.error, 'plugin disconnected')
    assert.deepEqual(reconnected.snapshot.positions, [], 'the pre-outage measurement is still what is held')

    quiet.write(`${JSON.stringify({ v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [{ code: 'US.TSLA' }], totals: {} }, updatedAt: Date.now() })}\n`)
    await settle()
    assert.equal(source.snapshot('futu-poller').state, 'live', 'publishing is what makes it live again')
    quiet.destroy()
  } finally {
    await source.stop()
  }
})
