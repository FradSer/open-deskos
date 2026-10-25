'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { readHydraControlKey } = require('../src/hydra-control-key')
const { createHydraControlBroker } = require('../src/hydra-control-broker')
const { TYPES, encodeControlFrame, decodeControlFrame } = require('../src/hydra-control-codec')
const KEY = Buffer.alloc(32, 7), MAIN = '02:00:00:00:00:01', GATEWAY = '02:00:00:00:00:02'
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  let time = 0, deviceTime = options.deviceTime ?? 1000, authorized = true, key = KEY, broker, timerId = 0
  let context = { peer: MAIN, gateway: GATEWAY, generation: 1, boot: 'hello-boot', connected: true }
  const sent = [], timers = new Map()
  function response(frame, extra) { broker.receive({ peer: MAIN, payload: encodeControlFrame({ ...frame, boot: 9n, challenge: frame.commandId ? Buffer.alloc(16, 3) : Buffer.alloc(16), ...extra }, KEY).toString('base64') }) }
  const gateway = { async action(action) {
    const frame = decodeControlFrame(Buffer.from(action.payload, 'base64'), KEY, { main: MAIN, gateway: GATEWAY }); assert.ok(frame); sent.push(frame)
    if (options.onSend) return options.onSend(frame, response)
    if (frame.type === TYPES.QUERY) { const body = Buffer.alloc(8); body.writeBigUInt64LE(frame.commandId || 9007199254740993n); response(frame, { type: 2, deadline: frame.commandId ? (deviceTime + 5000) >>> 0 : 0, body }) }
    return { ok: true, delivery: 'mac-receipt' }
  } }
  broker = createHydraControlBroker({ deviceGateway: gateway, getContext: () => ({ ...context }), readKey: () => key,
    planStore: options.planStore || { get: () => 0, reserve: async () => {} }, unixNow: () => 1700000000000, authorize: event => authorized && event === 'trusted', now: () => time, randomToken: () => 'fixture-confirm-token',
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {}, setTimeoutFn: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, due: time + ms }); return id }, clearTimeoutFn: id => timers.delete(id) })
  return { broker, sent, present: () => broker.action({ type: 'control-visibility', visible: true }, 'trusted'),
    tick(ms) { time += ms; deviceTime = (deviceTime + ms) >>> 0; for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); timer.fn() }; broker.tick() },
    context(value) { context = { ...context, ...value }; broker.sync() }, authorize(value) { authorized = value }, key(value) { key = value },
    ack(frame, { code = 1, owner = false, end = 0, deadline = (deviceTime + 5000) >>> 0 } = {}) { const body = Buffer.alloc(7); body[0] = frame.body[0]; body[1] = code; body[2] = Number(owner); body.writeUInt32LE(end, 3); response(frame, { type: 6, deadline, body }) } }
}
test('private key requires exact safe POSIX file and refuses links and unverified Windows', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-key-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); const file = path.join(fs.realpathSync(dir), 'key')
  fs.writeFileSync(file, KEY, { mode: 0o600 }); assert.deepEqual(readHydraControlKey(file), KEY)
  fs.chmodSync(file, 0o644); assert.throws(() => readHydraControlKey(file)); fs.chmodSync(file, 0o600)
  const alias = path.join(dir, 'alias'); fs.symlinkSync(file, alias); assert.throws(() => readHydraControlKey(alias))
  const link = path.join(dir, 'link'); fs.linkSync(file, link); assert.throws(() => readHydraControlKey(file)); fs.unlinkSync(link)
  assert.throws(() => readHydraControlKey(file, { platform: 'win32' })); fs.writeFileSync(file, Buffer.alloc(31)); assert.throws(() => readHydraControlKey(file))
})
test('unsafe key, unrelated frames and invisible Devices cannot prepare', async () => {
  const f = fixture(); assert.equal((await f.broker.action({ type: 'prepare-water', node: 1, durationMs: 100 }, 'trusted')).ok, false)
  await f.present(); f.key(null); assert.equal((await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted')).ok, false)
  f.key(KEY); assert.equal((await f.broker.action({ type: 'prepare-stop', node: 1 }, 'foreign')).error, 'unauthorized'); assert.equal(f.sent.length, 0)
  assert.doesNotThrow(() => JSON.stringify(f.broker.snapshot()))
})
test('prepare gets only signed status; confirm gets fresh challenge and signs immutable payload once', async () => {
  const f = fixture(); await f.present(); const action = { type: 'prepare-water', node: 1, durationMs: 1200 }
  const p = await f.broker.action(action, 'trusted'); assert.equal(p.ok, true); assert.deepEqual(f.sent.map(x => x.type), [1]); assert.equal(f.sent[0].commandId, 0n)
  action.durationMs = 30000; const confirmed = await f.broker.action({ type: 'confirm', token: p.token }, 'trusted'); assert.equal(confirmed.ok, true)
  assert.deepEqual(f.sent.map(x => x.type), [1, 1, 3]); assert.equal(f.sent[2].body.readUInt32LE(1), 1200); assert.equal(f.sent[2].commandId, 9007199254740994n)
  assert.equal(f.broker.snapshot().result.state, 'awaiting-ack'); assert.equal((await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')).ok, false)
  const json = JSON.stringify(f.broker.snapshot()); assert.ok(!json.includes(KEY.toString('hex'))); assert.ok(!json.includes('payload')); assert.equal(typeof confirmed.commandId, 'string')
})
test('peer, gateway, generation, hello, link, key, authority and visibility revoke pending tokens', async () => {
  for (const change of [f => f.context({ peer: '02:00:00:00:00:03' }), f => f.context({ gateway: '02:00:00:00:00:04' }), f => f.context({ generation: 2 }), f => f.context({ boot: 'new-hello' }), f => f.context({ connected: false }), f => f.key(Buffer.alloc(32, 8)), f => f.authorize(false), f => f.broker.action({ type: 'control-visibility', visible: false }, 'trusted')]) {
    const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted'); await change(f)
    assert.equal((await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')).ok, false); assert.equal(f.sent.some(x => x.type === 4), false)
  }
})
test('late challenge after teardown cannot send a command', async () => {
  let pending
  const f = fixture({ onSend(frame, respond) { if (!frame.commandId) { const body = Buffer.alloc(8); respond(frame, { type: 2, body, deadline: 0 }) } else pending = () => { const body = Buffer.alloc(8); body.writeBigUInt64LE(frame.commandId); respond(frame, { type: 2, body, deadline: 6000 }) }; return { ok: true } } })
  await f.present(); const p = await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted'); const confirming = f.broker.action({ type: 'confirm', token: p.token }, 'trusted'); await flush()
  await f.broker.action({ type: 'control-visibility', visible: false }, 'trusted'); pending(); assert.equal((await confirming).ok, false); assert.equal(f.sent.some(x => x.type === 4), false)
})
test('lost main ACK becomes unknown without action replay or heartbeats', async () => {
  const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-water', node: 1, durationMs: 30000 }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
  f.tick(1001); assert.equal(f.broker.snapshot().result.state, 'unknown'); assert.equal(f.sent.filter(x => x.type === 3).length, 1); assert.equal(f.sent.some(x => x.type === 7), false)
})
test('water ACK starts counter heartbeats capped by wrap-zero lease and keeps physical owner separate', async () => {
  const f = fixture({ deviceTime: 0xfffffc18 }); await f.present(); const p = await f.broker.action({ type: 'prepare-water', node: 1, durationMs: 1000 }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
  const water = f.sent.find(x => x.type === 3); f.ack(water, { owner: true, end: 0 }); assert.equal(f.broker.snapshot().physicalOwner, true)
  f.tick(250); await flush(); let hb = f.sent.filter(x => x.type === 7); assert.equal(hb.length, 1); assert.equal(hb[0].body.readUInt32LE(1), 1); assert.equal(hb[0].deadline, 0)
  await f.present(); f.tick(250); await flush(); hb = f.sent.filter(x => x.type === 7); assert.equal(hb[1].body.readUInt32LE(1), 2)
  f.tick(500); await flush(); assert.equal(f.sent.filter(x => x.type === 7).length, 2); assert.equal(f.broker.snapshot().lease.active, false)
})
test('plan ACK admission and leaf installation history never claim pump execution', async () => {
  const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-plan', node: 2, season: 0, entries: [] }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
  const frame = f.sent.find(x => x.type === 5); f.ack(frame); assert.equal(f.broker.snapshot().result.state, 'accepted-main'); f.ack(frame, { code: 2 }); assert.equal(f.broker.snapshot().result.state, 'leaf-installed')
  assert.equal(f.sent.some(x => x.type === 7), false); assert.ok(!JSON.stringify(f.broker.snapshot()).includes('pump'))
})
test('invalid typed actions never query, and expired confirmation cannot actuate', async () => {
  const f = fixture(); await f.present()
  for (const action of [{ type: 'prepare-water', node: 1, durationMs: 30001 }, { type: 'prepare-stop', node: 7 }, { type: 'prepare-plan', node: 1, windowSeq: 0, season: 1, entries: [] }, { type: 'prepare-stop', node: 1, payload: 'anything' }]) assert.equal((await f.broker.action(action, 'trusted')).error, 'invalid-action')
  assert.equal(f.sent.length, 0)
  const p = await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted')
  for (let i = 0; i < 61; i++) { f.tick(500); await f.present() }
  assert.equal((await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')).ok, false); assert.equal(f.sent.some(x => x.type === 4), false)
})
test('a hung MAC receipt cannot trap query timeout or trigger a command after cancellation', async () => {
  const f = fixture({ onSend() { return new Promise(() => {}) } }); await f.present()
  const preparing = f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted'); f.tick(1001)
  assert.equal((await preparing).ok, false); assert.equal(f.sent.length, 1)
})
test('late unsigned or foreign ACK cannot start a lease and stopped broker does not reload its key', async () => {
  const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-water', node: 1, durationMs: 1000 }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
  const frame = f.sent.find(x => x.type === 3)
  const body = Buffer.from([1, 1, 0, 0, 0, 0, 0]), bytes = encodeControlFrame({ ...frame, type: 6, body, deadline: 6000 }, KEY); bytes[96] ^= 1
  assert.equal(f.broker.receive({ peer: MAIN, payload: bytes.toString('base64') }), false); assert.equal(f.broker.snapshot().lease.active, false)
  f.context({ connected: false }); f.ack(frame, { end: 2000 }); assert.equal(f.broker.snapshot().lease.active, false)
  f.broker.stop(); assert.equal(f.broker.snapshot().available, false)
})
test('private key read detects pathname replacement while the original descriptor stays open', t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-key-race-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'key'); fs.writeFileSync(file, KEY, { mode: 0o600 }); const read = fs.readSync
  const mock = t.mock.method(fs, 'readSync', function (...args) { const result = read.apply(this, args); fs.renameSync(file, file + '.old'); fs.writeFileSync(file, KEY, { mode: 0o600 }); return result })
  assert.throws(() => readHydraControlKey(file)); mock.mock.restore()
})
test('accepted lease is never extended by duplicate ACK and presence expiry stops heartbeat', async () => {
  const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-water', node: 1, durationMs: 10000 }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
  const water = f.sent.find(x => x.type === 3); f.ack(water, { end: 11000 }); f.tick(250); await flush(); f.ack(water, { end: 21000 }); assert.ok(f.broker.snapshot().lease.remainingMs <= 9750)
  f.tick(751); await flush(); const count = f.sent.length; assert.equal(f.broker.snapshot().lease.active, false); f.tick(500); await flush(); assert.equal(f.sent.length, count)
})
test('plan chooses a host high-water sequence and reserves immutable summary before send', async () => {
  let high = 1700000010, reserved = []
  const f = fixture({ planStore: { get: () => high, reserve: async (peer, node, seq) => { reserved.push({ peer, node, seq }); high = seq } } }); await f.present()
  assert.equal((await f.broker.action({ type: 'prepare-plan', node: 1, windowSeq: 1, season: 0, entries: [] }, 'trusted')).ok, false)
  const p = await f.broker.action({ type: 'prepare-plan', node: 1, season: 0, entries: [] }, 'trusted'); assert.equal(p.summary.windowSeq, 1700000011); assert.equal(reserved.length, 0)
  await f.broker.action({ type: 'confirm', token: p.token }, 'trusted'); assert.deepEqual(reserved, [{ peer: MAIN, node: 1, seq: 1700000011 }]); assert.equal(f.sent.find(x => x.type === 5).body.readUInt32LE(1), 1700000011)
  f.tick(1001); await f.present(); const next = await f.broker.action({ type: 'prepare-plan', node: 1, season: 0, entries: [] }, 'trusted'); assert.equal(next.summary.windowSeq, 1700000012); assert.equal(f.broker.snapshot().planSequence.deviceKnown, false)
})
test('failed reservation or teardown while persisting a sequence never sends the plan', async () => {
  const broken = fixture({ planStore: { get: () => 0, reserve: async () => { throw Error('private state unavailable') } } }); await broken.present(); const p = await broken.broker.action({ type: 'prepare-plan', node: 1, season: 0, entries: [] }, 'trusted')
  assert.equal((await broken.broker.action({ type: 'confirm', token: p.token }, 'trusted')).error, 'plan-state-unavailable'); assert.equal(broken.sent.some(x => x.type === 5), false)
  let finish, reserved = 0
  const f = fixture({ planStore: { get: () => 0, reserve: (peer, node, seq) => { reserved = seq; return new Promise(resolve => { finish = resolve }) } } }); await f.present(); const prepared = await f.broker.action({ type: 'prepare-plan', node: 1, season: 0, entries: [] }, 'trusted')
  const pending = f.broker.action({ type: 'confirm', token: prepared.token }, 'trusted'); await flush(); assert.ok(reserved > 0); await f.broker.action({ type: 'control-visibility', visible: false }, 'trusted'); finish()
  assert.equal((await pending).ok, false); assert.equal(f.sent.some(x => x.type === 5), false)
})
test('a late old query-zero delivery failure cannot cancel the next status request', async () => {
  let releaseFirst, deliverSecond, count = 0
  const f = fixture({ onSend(frame, respond) {
    const body = Buffer.alloc(8); body.writeBigUInt64LE(5n)
    if (++count === 1) { respond(frame, { type: 2, body, deadline: 0 }); return new Promise(resolve => { releaseFirst = resolve }) }
    deliverSecond = () => respond(frame, { type: 2, body, deadline: 0 }); return { ok: true }
  } })
  await f.present(); assert.equal((await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted')).ok, true)
  const second = f.broker.action({ type: 'prepare-stop', node: 2 }, 'trusted'); await flush(); releaseFirst({ ok: false }); await flush(); deliverSecond()
  assert.equal((await second).ok, true); assert.equal(f.sent.some(frame => frame.type === 4), false)
})
test('main ACK time must fall within its exact challenge window before lease supervision starts', async () => {
  for (const [deadline, end] of [[5000, 30000], [11000, 36000]]) {
    const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-water', node: 1, durationMs: 30000 }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
    const water = f.sent.find(x => x.type === 3); f.ack(water, { deadline, end }); assert.equal(f.broker.snapshot().result.state, 'awaiting-ack'); assert.equal(f.broker.snapshot().lease.active, false)
  }
})
test('later leaf installation history is not rejected as an expired action acknowledgement', async () => {
  const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-plan', node: 1, season: 0, entries: [] }, 'trusted'); await f.broker.action({ type: 'confirm', token: p.token }, 'trusted')
  const plan = f.sent.find(x => x.type === 5); f.ack(plan)
  for (let i = 0; i < 12; i++) { f.tick(500); await f.present() }
  f.ack(plan, { code: 2 }); assert.equal(f.broker.snapshot().result.state, 'leaf-installed')
})

test('identity changes discard awaiting observations but same-peer cancellation retains unknown history', async () => {
  const changes = [
    f => f.context({ peer: '02:00:00:00:00:03' }),
    f => f.context({ gateway: '02:00:00:00:00:04' }),
    f => f.context({ generation: 2 }), f => f.context({ boot: 'new-hello' }),
    f => f.context({ connected: false }), f => f.key(Buffer.alloc(32, 8)),
    f => { const command = f.sent.find(frame => frame.type === TYPES.STOP); const body = Buffer.from([1, 1, 0, 0, 0, 0, 0]); f.broker.receive({ peer: MAIN, payload: encodeControlFrame({ ...command, type: TYPES.ACK, boot: 10n, deadline: 6000, body }, KEY).toString('base64') }) }
  ]
  for (const change of changes) {
    const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted')
    await f.broker.action({ type: 'confirm', token: p.token }, 'trusted'); assert.equal(f.broker.snapshot().result.state, 'awaiting-ack')
    await change(f); const state = f.broker.snapshot(); assert.equal(state.result, null); assert.equal(state.physicalOwner, null); assert.equal(state.lease.active, false)
  }
  for (const action of [{ type: 'cancel' }, { type: 'control-visibility', visible: false }]) {
    const f = fixture(); await f.present(); const p = await f.broker.action({ type: 'prepare-stop', node: 1 }, 'trusted')
    await f.broker.action({ type: 'confirm', token: p.token }, 'trusted'); await f.broker.action(action, 'trusted')
    assert.deepEqual(f.broker.snapshot().result, { state: 'unknown', action: 'stop', node: 1, commandId: '9007199254740994' })
  }
})
