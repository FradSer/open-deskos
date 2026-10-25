'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
function fixtureBridgeEntry(filename = __filename) {
  const path = require('node:path'), fs = require('node:fs')
  const candidates = ['../integrations/remote-bridge/lib/remote-bridge.js', '../../../integrations/remote-bridge/lib/remote-bridge.js']
    .map(relative => path.resolve(path.dirname(filename), relative))
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}
function loadFixtureBridge(filename = __filename) {
  // Select the entry before loading it. Errors inside the module must propagate.
  return createRequire(filename)(fixtureBridgeEntry(filename))
}
function assertFixturePath(root, target) {
  const path = require('node:path')
  const relative = path.relative(root, target)
  assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`), 'fixture path must stay inside its temporary root')
  return target
}
function removeFixtureRootAfter(t, fs, root) {
  const path = require('node:path'), syncFs = require('node:fs')
  const outside = path.join(path.dirname(root), 'integrations')
  const existed = syncFs.existsSync(outside)
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true })
    assert.equal(syncFs.existsSync(root), false, 'fixture root must be removed after completion')
    assert.equal(syncFs.existsSync(outside), existed, 'fixture must not create an outer integrations directory')
  })
}
const { createBridgeDeviceSource } = require('../src/device-bridge-source')
test('device facade authorizes IPC and releases only its subscriptions', async () => {
  let stop = 0, unlisten = 0, actions = 0, listener
  const client = { stop() { stop++ }, getDeviceSnapshot: () => ({ status: 'live', events: [] }), onDeviceSnapshot(fn) { listener = fn; return () => { unlisten++ } }, deviceAction: async action => { actions++; return action.type === 'status' ? { ok: true, snapshot: { status: 'live', events: [] } } : { ok: true, delivery: 'usb-reply' } } }
  const source = createBridgeDeviceSource({ client, authorize: event => event === 'trusted' })
  assert.deepEqual(await source.dispatch('untrusted', { type: 'ping' }), { ok: false, error: 'unauthorized' })
  assert.equal(actions, 0)
  assert.equal((await source.dispatch('trusted', { type: 'status' })).status, 'live')
  assert.equal((await source.action({ type: 'ping' })).ok, true)
  listener({ status: 'disconnected', events: [] })
  assert.equal(source.snapshot().status, 'disconnected')
  source.stop(); source.stop()
  assert.equal(stop, 0); assert.equal(unlisten, 1)
  assert.deepEqual(await source.action({ type: 'ping' }), { ok: false, error: 'unavailable' })
})

test('facade snapshot subscriptions retain cleanup ownership after a failed release', () => {
  let fail = true, released = 0, update
  const source = createBridgeDeviceSource({ client: { getDeviceSnapshot: () => ({ status: 'live' }), onDeviceSnapshot(fn) { update = fn; return () => { if (fail) throw Error('retained subscription'); released++ } } } })
  const observed = []; source.onSnapshot(value => observed.push(value.status))
  update({ status: 'disconnected' }); assert.deepEqual(observed, ['live', 'disconnected'])
  assert.throws(() => source.stop(), /cleanup failed/)
  fail = false; source.stop(); assert.equal(released, 1)
  update({ status: 'live' }); assert.equal(source.snapshot().status, 'disconnected')
})

test('client device correlation times out without replay and disconnect invalidates caches', async t => {
  const { EventEmitter } = require('node:events')
  const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
  const socket = new EventEmitter(), writes = []
  Object.assign(socket, { write(line) { writes.push(JSON.parse(line)); return true }, destroy() { this.destroyed = true; this.emit('close') } })
  const client = createRemoteBridgeClient({ socketPath: '/private/bridge.sock', createConnection: () => socket, deviceTimeoutMs: 15 })
  client.start(); socket.emit('connect'); t.after(() => client.stop())
  const sending = client.deviceAction({ type: 'send', peer: '02:00:00:00:00:02', payload: 'eA==' })
  assert.equal(writes.length, 1)
  const requestId = writes[0].requestId
  socket.emit('data', Buffer.from(JSON.stringify({ v: 1, type: 'device_reply', requestId: '00000000-0000-0000-0000-000000000000', result: { ok: true } }) + '\n'))
  assert.deepEqual(await sending, { ok: false, error: 'delivery-unknown' })
  assert.equal(writes.length, 1)
  socket.emit('data', Buffer.from(JSON.stringify({ v: 1, type: 'device_reply', requestId, result: { ok: true } }) + '\n'))
  const snapshot = { status: 'live', gateway: { status: 'live' }, remote: { status: 'ready' }, peers: [], events: [] }
  socket.emit('data', Buffer.from(JSON.stringify({ v: 1, type: 'device_snapshot', snapshot }) + '\n'))
  assert.equal(client.getDeviceSnapshot().status, 'live')
  const ping = client.deviceAction({ type: 'ping' })
  client.stop()
  assert.deepEqual(await ping, { ok: false, error: 'unavailable' })
  assert.equal(client.getDeviceSnapshot().status, 'disconnected')
})

test('oversized Bridge records cannot inject a valid-looking tail after a split read', () => {
  const { EventEmitter } = require('node:events')
  const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
  const socket = new EventEmitter(); Object.assign(socket, { write() {}, destroy() {} })
  const client = createRemoteBridgeClient({ socketPath: '/private/bridge.sock', createConnection: () => socket })
  const inputs = []; client.onInput(input => inputs.push(input)); client.start()
  socket.emit('data', Buffer.from('x'.repeat(2049)))
  socket.emit('data', Buffer.from('{"v":1,"type":"input","input":"primary"}\n{"v":1,"type":"input","input":"back"}\n'))
  assert.deepEqual(inputs, ['back']); client.stop()
})

async function exerciseSharedBridge(t, RemoteBridge) {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const { EventEmitter } = require('node:events')
  const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-device-client-'))
  const adapter = new EventEmitter(); let started = 0
  const snapshot = { status: 'live', gateway: { status: 'live' }, remote: { status: 'ready' }, peers: [], events: [] }
  Object.assign(adapter, { start: async () => { started++ }, stop: async () => {}, deviceSnapshot: () => snapshot, deviceAction: async () => ({ ok: true, delivery: 'usb-reply' }) })
  const bridge = new RemoteBridge({ adapter, socketPath: assertFixturePath(directory, path.join(directory, 'bridge.sock')), logger: { error() {} } })
  await bridge.start()
  const client = createRemoteBridgeClient({ socketPath: bridge.socketPath })
  const source = createBridgeDeviceSource({ client, authorize: () => true })
  const inputs = [], events = []; client.onInput(input => inputs.push(input)); source.onEvent(event => events.push(event))
  client.start()
  t.after(async () => { source.stop(); client.stop(); await bridge.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  for (let i = 0; i < 30 && source.snapshot().status !== 'live'; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(source.snapshot().status, 'live')
  assert.equal(bridge.clients.size, 1); assert.equal(started, 1)
  adapter.emit('message', { v: 1, type: 'input', input: 'back' })
  adapter.emit('device-event', { peer: '02:00:00:00:00:02', payload: 'eA==', receivedAt: 1000 })
  for (let i = 0; i < 30 && events.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(inputs, ['back']); assert.equal(events.length, 1)
  assert.equal((await source.action({ type: 'ping' })).delivery, 'usb-reply')
  source.stop()
  assert.equal(bridge.clients.size, 1)
  assert.equal((await client.deviceAction({ type: 'ping' })).ok, true)
}

test('facade and Remote input share the real private Bridge in both layouts', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const integration = path.dirname(path.dirname(createRequire(__filename).resolve(fixtureBridgeEntry())))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-layout-'))
  removeFixtureRootAfter(t, fs, root)
  for (const layout of ['repository', 'flattened']) {
    await t.test(layout, async subtest => {
      const base = assertFixturePath(root, path.join(root, 'host', layout))
      const filename = path.join(base, layout === 'repository' ? 'runtime/shell/tests/device.test.js' : 'tests/device.test.js')
      assertFixturePath(root, filename)
      for (const relative of ['../integrations/remote-bridge/lib/remote-bridge.js', '../../../integrations/remote-bridge/lib/remote-bridge.js']) {
        assertFixturePath(root, path.resolve(path.dirname(filename), relative))
      }
      await fs.mkdir(assertFixturePath(root, path.dirname(filename)), { recursive: true })
      await fs.mkdir(assertFixturePath(root, path.join(base, 'integrations')))
      await fs.symlink(integration, assertFixturePath(root, path.join(base, 'integrations/remote-bridge')), 'dir')
      const { RemoteBridge } = loadFixtureBridge(filename)
      await exerciseSharedBridge(subtest, RemoteBridge)
    })
  }
})

test('Bridge layout selection prefers the nearest release entry when both candidates exist', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-layout-precedence-'))
  removeFixtureRootAfter(t, fs, root)
  const filename = assertFixturePath(root, path.join(root, 'host/candidate/tests/device.test.js'))
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const nearest = path.resolve(path.dirname(filename), '../integrations/remote-bridge/lib/remote-bridge.js')
  const outer = path.resolve(path.dirname(filename), '../../../integrations/remote-bridge/lib/remote-bridge.js')
  for (const entry of [nearest, outer]) {
    assertFixturePath(root, entry)
    await fs.mkdir(assertFixturePath(root, path.dirname(entry)), { recursive: true })
  }
  await fs.writeFile(nearest, "module.exports={source:'candidate-release'}\n")
  await fs.writeFile(outer, "module.exports={source:'stale-outer-copy'}\n")
  assert.equal(fixtureBridgeEntry(filename), nearest)
  assert.equal(loadFixtureBridge(filename).source, 'candidate-release')
})

test('Bridge layout selection never hides a dependency missing inside the selected entry', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-layout-missing-'))
  removeFixtureRootAfter(t, fs, root)
  const filename = assertFixturePath(root, path.join(root, 'runtime/shell/tests/device.test.js'))
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const first = path.join(root, 'runtime/shell/integrations/remote-bridge/lib/remote-bridge.js')
  const fallback = path.join(root, 'integrations/remote-bridge/lib/remote-bridge.js')
  for (const entry of [first, fallback]) {
    assertFixturePath(root, entry)
    await fs.mkdir(assertFixturePath(root, path.dirname(entry)), { recursive: true })
  }
  await fs.writeFile(first, "require('./intentionally-missing-layout-dependency')\n")
  await fs.writeFile(fallback, "throw Error('Fallback must not hide an inner dependency failure')\n")
  assert.throws(() => loadFixtureBridge(filename), error => error.code === 'MODULE_NOT_FOUND' && error.message.includes('intentionally-missing-layout-dependency'))
})

test('late status continuation cannot overwrite a newer disconnect snapshot', async () => {
  let listener, resolve
  const live = { status: 'live', remote: { status: 'ready' }, events: [] }
  const client = { getDeviceSnapshot: () => live, onDeviceSnapshot(fn) { listener = fn; return () => {} }, deviceAction: () => new Promise(yes => { resolve = yes }) }
  const source = createBridgeDeviceSource({ client })
  const refreshing = source.refresh()
  resolve({ ok: true, snapshot: live })
  listener({ status: 'disconnected', remote: { status: 'disconnected' }, events: [] })
  assert.equal((await refreshing).status, 'disconnected')
  source.stop()
})

test('silent live Bridge socket loses cached readiness on a bounded clock deadline', () => {
  const { EventEmitter } = require('node:events')
  const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
  const socket = new EventEmitter(); Object.assign(socket, { write() {}, destroy() {} })
  let now = 1000
  const tasks = new Map(); let id = 0
  const client = createRemoteBridgeClient({ socketPath: '/private/bridge.sock', createConnection: () => socket, now: () => now, setTimeoutFn: fn => { tasks.set(++id, fn); return id }, clearTimeoutFn: id => tasks.delete(id) })
  const statuses = []; client.onDeviceSnapshot(snapshot => statuses.push(snapshot.status)); client.start()
  const snapshot = { status: 'live', gateway: { status: 'live' }, remote: { status: 'ready' }, peers: [], events: [{ peer: '02:00:00:00:00:02', payload: 'eA==', receivedAt: 1000 }] }
  socket.emit('data', Buffer.from(JSON.stringify({ v: 1, type: 'device_snapshot', snapshot }) + '\n'))
  assert.equal(client.getDeviceSnapshot().remote.status, 'ready')
  now += 3501
  for (const task of [...tasks.values()]) task()
  assert.equal(socket.destroyed, undefined)
  assert.equal(client.getDeviceSnapshot().status, 'disconnected')
  assert.deepEqual(client.getDeviceSnapshot().events, [])
  assert.equal(statuses.at(-1), 'disconnected')
  client.stop()
})
