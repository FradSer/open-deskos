'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHydraEspNowSource, decodeHydraTelemetry } = require('../src/hydra-espnow')
const { createHydraPeerStore } = require('../src/hydra-peer-store')
const A = '02:11:22:33:44:55', B = '02:11:22:33:44:66', REMOTE = 'f0:9e:9e:11:23:cc'
const BOOT = '0123456789abcdef'
const hello = (seq = 1, boot = BOOT) => ({ p: 'hydra', v: 1, k: 'hello', boot, seq, firmware: 'hydra-1.0', uptime: 10, clock: false })
const env = (seq = 2, age = 0) => ({ p: 'hydra', v: 1, k: 'env', boot: BOOT, seq, age, valid: true, tc: 24.5, rh: 61.2, hp: 1002.6, lx: 12340, vp: 1.23 })
const node = (seq = 3, age = 0) => ({ p: 'hydra', v: 1, k: 'node', boot: BOOT, seq, age, id: 1, online: true, soil: 62.4, status: 'PULSE' })
function fixture(options = {}) {
  let time = 1700000000000, saved = A
  const events = new Set(), snapshots = new Set(), captured = []
  let state = { status: 'live', gateway: { status: 'live', mac: '02:00:00:00:00:02' }, remote: { mac: REMOTE }, peers: [{ mac: A, role: 'device', status: 'stale' }, { mac: B, role: 'device', status: 'paired' }, { mac: REMOTE, role: 'remote' }] }
  const gateway = { snapshot: () => structuredClone(state), action: options.gatewayAction || (() => assert.fail('telemetry never sends')),
    onEvent(fn) { events.add(fn); captured.push(fn); return () => events.delete(fn) },
    onSnapshot(fn) { snapshots.add(fn); return () => snapshots.delete(fn) }, stop: () => assert.fail('Hydra cannot stop Bridge') }
  const source = createHydraEspNowSource({ deviceGateway: gateway, peerStore: { load: () => saved, save: async peer => { saved = peer } }, now: () => time,
    authorize: event => event === 'trusted', setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {}, ...options })
  return { source, gateway, captured, events, snapshots, saved: () => saved, tick: ms => { time += ms }, emit(record, peer = A) { const event = { peer, payload: Buffer.from(JSON.stringify(record)).toString('base64'), receivedAt: time }; for (const fn of events) fn(event) }, disconnect() { state = { ...state, status: 'disconnected', gateway: { status: 'disconnected' } }; for (const fn of snapshots) fn(state) }, time: () => time }
}
test('telemetry decoder enforces exact versioned bounded read-only frames', () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64')
  assert.equal(decodeHydraTelemetry(encode(hello())).k, 'hello')
  for (const value of [{ ...hello(), password: 'secret' }, { ...hello(), seq: 0 }, { ...hello(), boot: BOOT.toUpperCase() }, { ...hello(), boot: [BOOT] }, { ...env(), tc: '24' }, { ...node(), id: 7 }, { ...node(), soil: 101 }, { ...node(), k: 'pump' }]) assert.equal(decodeHydraTelemetry(encode(value)), null)
  assert.equal(decodeHydraTelemetry(Buffer.alloc(251).toString('base64')), null)
})
test('existing snapshot values, units, statuses and measurement ages survive the transport', async () => {
  const f = fixture(); f.emit(env()); assert.equal(f.source.snapshot().env, null)
  f.emit(hello()); f.emit(env()); f.emit(node())
  const snapshot = f.source.snapshot()
  assert.equal(snapshot.connected, true); assert.equal(snapshot.mainOnline, true)
  assert.equal(snapshot.env.tempC, 24.5); assert.equal(snapshot.env.vpdKpa, 1.23)
  assert.equal(snapshot.nodes[0].soilPercent, 62.4); assert.equal(snapshot.nodes[0].pump, true)
  assert.equal(f.source.deviceSnapshot().clockValid, false)
  f.emit({ ...node(4, 180001), status: 'IDLE', soil: null }); assert.equal(f.source.snapshot().nodes[0].stale, true)
  f.emit(env(5, 300001)); assert.equal(f.source.snapshot().env.stale, true)
  f.emit({ p: 'hydra', v: 1, k: 'env', boot: BOOT, seq: 6, age: 0, valid: false }); assert.equal(f.source.snapshot().env, null)
  await f.source.stop()
})
test('foreign peers, duplicate sequences, out of order and retired boots cannot publish', async () => {
  const f = fixture(); f.emit(hello(), B); f.emit(env()); assert.equal(f.source.snapshot().env, null)
  f.emit(hello()); f.emit(env(3)); f.emit({ ...env(3), tc: 99 }); f.emit({ ...env(2), tc: 98 }); assert.equal(f.source.snapshot().env.tempC, 24.5)
  f.emit(hello(1, 'abcdef0123456789')); f.emit(hello(99)); f.emit(env(100)); assert.equal(f.source.snapshot().env, null)
  await f.source.stop()
})
test('Hydra liveness ignores generic peer age but link loss and heartbeat expiry invalidate it', async () => {
  const f = fixture(); f.emit(hello()); f.emit(env()); f.emit(node())
  f.tick(5000); assert.equal(f.source.deviceSnapshot().status, 'live')
  f.tick(5001); assert.equal(f.source.snapshot().connected, false); assert.equal(f.source.deviceSnapshot().status, 'unavailable')
  f.emit(env(4)); assert.equal(f.source.snapshot().env.tempC, 24.5)
  f.emit(hello(5)); assert.equal(f.source.deviceSnapshot().status, 'live')
  f.disconnect(); assert.equal(f.source.deviceSnapshot().status, 'unavailable'); assert.equal(f.source.snapshot().connected, false)
  await f.source.stop()
})
test('trusted serialized management refuses arbitrary and reserved peers and clears old generations', async () => {
  const f = fixture(); f.emit(hello()); f.emit(env())
  assert.equal((await f.source.dispatchDevice('other', { type: 'bind', peer: B })).error, 'unauthorized')
  assert.equal((await f.source.dispatchDevice('trusted', { type: 'bind', peer: REMOTE })).ok, false)
  assert.equal((await f.source.dispatchDevice('trusted', { type: 'send', peer: A, payload: 'eA==' })).ok, false)
  const old = f.captured[0]
  assert.equal((await f.source.dispatchDevice('trusted', { type: 'bind', peer: B.toUpperCase() })).ok, true)
  assert.equal(f.saved(), B); assert.equal(f.source.snapshot().env, null)
  old({ peer: A, payload: Buffer.from(JSON.stringify(env(9))).toString('base64'), receivedAt: f.time() }); assert.equal(f.source.snapshot().env, null)
  assert.equal((await f.source.dispatchDevice('trusted', { type: 'unbind' })).ok, true); assert.equal(f.source.deviceSnapshot().status, 'unconfigured')
  await f.source.stop(); assert.equal(f.events.size, 0); assert.equal(f.snapshots.size, 0)
})
test('private peer profile is bounded, atomic, serial and cannot follow a symlink', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-peer-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'hydra-espnow.json'), store = createHydraPeerStore(file)
  assert.equal(store.load(), null)
  await Promise.all([store.save(A), store.save(B), store.save(null)])
  assert.equal(store.load(), null); assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  await fs.unlink(file); await fs.symlink(path.join(root, 'victim'), file); await assert.rejects(store.save(A))
  assert.throws(() => store.load())
})

test('offline historical environment is explicitly stale without changing its measurement time', async () => {
  const f = fixture(); f.emit(hello()); f.emit(env()); const measured = f.source.snapshot().env.updatedAt
  f.disconnect(); assert.equal(f.source.snapshot().env.stale, true); assert.equal(f.source.snapshot().env.updatedAt, measured)
  await f.source.stop()
})

test('queued management rechecks frame authority and cannot dispatch a pump', async () => {
  let frame = true, release, writes = 0
  const f = fixture({ authorize: () => frame, peerStore: { load: () => A, save: () => { writes++; return new Promise(resolve => { release = resolve }) } } })
  const bind = f.source.dispatchDevice('trusted', { type: 'bind', peer: B })
  await new Promise(resolve => setImmediate(resolve))
  const unbind = f.source.dispatchDevice('trusted', { type: 'unbind' }); frame = false; release()
  assert.equal((await bind).ok, true); assert.equal((await unbind).error, 'unauthorized'); assert.equal(writes, 1)
  await f.source.stop()
})

test('subscription cleanup failure blocks a second listener and remains retryable', async () => {
  let fail = true, calls = 0, saved = A
  const f = fixture({ peerStore: { load: () => A, save: async peer => { saved = peer } }, deviceGateway: {
    snapshot: () => ({ status: 'live', gateway: { status: 'live', mac: '02:00:00:00:00:02' }, remote: { mac: REMOTE }, peers: [{ mac: A, role: 'device' }, { mac: B, role: 'device' }] }),
    onEvent: () => { calls++; return () => { if (fail) throw Error('cleanup unavailable') } },
  } })
  assert.equal((await f.source.dispatchDevice('trusted', { type: 'bind', peer: B })).ok, false)
  assert.equal(saved, B); assert.equal(f.source.deviceSnapshot().peer, B); assert.equal(f.source.deviceSnapshot().status, 'unavailable'); assert.equal(calls, 1)
  await assert.rejects(f.source.stop(), /cleanup failed/)
  fail = false; await f.source.stop(); assert.equal(calls, 1)
})

test('retired boot IDs reject queued old sessions without a permanent reboot ceiling', async () => {
  const f = fixture()
  for (let index = 1; index <= 70; index++) {
    f.tick(10001)
    f.emit({ ...hello(1, index.toString(16).padStart(16, '0')), firmware: `hydra-${index}` })
  }
  assert.equal(f.source.deviceSnapshot().firmware, 'hydra-70'); assert.equal(f.source.deviceSnapshot().status, 'live')
  await f.source.stop()
})

test('negative or future measurement timestamps cannot become live readings', async () => {
  const f = fixture(); f.tick(100 - f.time()); f.emit(hello()); f.emit(env(2, 101))
  assert.equal(f.source.snapshot().env, null)
  f.captured[0]({ peer: A, payload: Buffer.from(JSON.stringify(env(3))).toString('base64'), receivedAt: f.time() + 1 })
  assert.equal(f.source.snapshot().env, null)
  await f.source.stop()
})

test('environment bounds match the firmware telemetry contract', () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64')
  for (const extra of [{ tc: -51 }, { tc: 101 }, { rh: -1 }, { rh: 101 }, { hp: 99 }, { hp: 1301 }, { lx: -1 }, { lx: 200001 }, { vp: -1 }, { vp: 101 }]) assert.equal(decodeHydraTelemetry(encode({ ...env(), ...extra })), null)
  for (const extra of [{ tc: -50 }, { tc: 100 }, { rh: 0 }, { rh: 100 }, { hp: 100 }, { hp: 1300 }, { lx: 0, vp: 0 }, { lx: 200000, vp: 100 }, { lx: null, vp: null }]) assert.equal(decodeHydraTelemetry(encode({ ...env(), ...extra })).k, 'env')
})

test('HDC control uses the existing selected-peer callback and shared send facade', async () => {
  const { encodeControlFrame, decodeControlFrame } = require('../src/hydra-control-codec')
  const key = Buffer.alloc(32, 8), gatewayMac = '02:00:00:00:00:02', callbacks = new Set(), sent = []
  let listeners = 0
  const bridge = { snapshot: () => ({ status: 'live', gateway: { status: 'live', mac: gatewayMac }, remote: { mac: REMOTE }, peers: [{ mac: A, role: 'device' }] }),
    onEvent(fn) { callbacks.add(fn); listeners++; return () => callbacks.delete(fn) }, onSnapshot() { return () => {} },
    action(action) {
      const packet = decodeControlFrame(Buffer.from(action.payload, 'base64'), key, { main: A, gateway: gatewayMac }); sent.push(packet)
      if (packet.type === 1) { const body = Buffer.alloc(8); body.writeBigUInt64LE(packet.commandId); const reply = encodeControlFrame({ ...packet, type: 2, boot: 9n, challenge: Buffer.alloc(16, packet.commandId ? 1 : 0), deadline: packet.commandId ? 5000 : 0, body }, key)
        for (const callback of callbacks) callback({ peer: A, payload: reply.toString('base64'), receivedAt: 1000 }) }
      return Promise.resolve({ ok: true, delivery: 'mac-receipt' }) }, stop() { assert.fail('broker cannot stop Bridge') } }
  const source = createHydraEspNowSource({ deviceGateway: bridge, peerStore: { load: () => A, save: async () => {} }, readControlKey: () => key,
    authorize: event => event === 'trusted', now: () => 1000, controlOptions: { now: () => 0 }, setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {} })
  for (const callback of callbacks) callback({ peer: A, payload: Buffer.from(JSON.stringify(hello())).toString('base64'), receivedAt: 1000 })
  await source.dispatchDevice('trusted', { type: 'control-visibility', visible: true })
  const prepared = await source.dispatchDevice('trusted', { type: 'prepare-stop', node: 1 }); assert.equal(prepared.ok, true)
  const confirmed = await source.dispatchDevice('trusted', { type: 'confirm', token: prepared.token }); assert.equal(confirmed.ok, true)
  assert.deepEqual(sent.map(packet => packet.type), [1, 1, 4]); assert.equal(listeners, 1); assert.equal(callbacks.size, 1)
  assert.equal(source.deviceSnapshot().control.result.state, 'awaiting-ack'); assert.doesNotThrow(() => JSON.stringify(source.deviceSnapshot()))
  await source.stop(); assert.equal(callbacks.size, 0)
})

test('unbind cancels control before asynchronous profile persistence completes', async () => {
  const { encodeControlFrame, decodeControlFrame } = require('../src/hydra-control-codec'), key = Buffer.alloc(32, 7), gateway = '02:00:00:00:00:02'
  let release, f; const sent = []
  f = fixture({ readControlKey: () => key, controlOptions: { now: () => 0 }, peerStore: { load: () => A, save: () => new Promise(resolve => { release = resolve }) },
    gatewayAction(action) { const frame = decodeControlFrame(Buffer.from(action.payload, 'base64'), key, { main: A, gateway }); sent.push(frame)
      if (frame.type === 1) { const body = Buffer.alloc(8); body.writeBigUInt64LE(frame.commandId); const bytes = encodeControlFrame({ ...frame, type: 2, boot: 9n, challenge: Buffer.alloc(16, frame.commandId ? 1 : 0), deadline: frame.commandId ? 5000 : 0, body }, key)
        for (const callback of f.events) callback({ peer: A, payload: bytes.toString('base64'), receivedAt: f.time() }) }
      return Promise.resolve({ ok: true }) } })
  f.emit(hello()); await f.source.dispatchDevice('trusted', { type: 'control-visibility', visible: true }); const prepared = await f.source.dispatchDevice('trusted', { type: 'prepare-stop', node: 1 })
  const unbind = f.source.dispatchDevice('trusted', { type: 'unbind' }); await new Promise(resolve => setImmediate(resolve))
  assert.equal((await f.source.dispatchDevice('trusted', { type: 'confirm', token: prepared.token })).ok, false); assert.equal(sent.some(frame => frame.type === 4), false)
  release(); await unbind; await f.source.stop()
})
