'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startupSelection, selectTransports } = require('../lib/main')

test('ESP-NOW mode never constructs USB and rejects mixed startup selection', () => {
  const unit = require('node:fs').readFileSync(require('node:path').join(__dirname, '../systemd/odk-remote-bridge.service'), 'utf8')
  assert.match(unit, /^EnvironmentFile=-%h\/\.config\/odk\/remote-bridge\.env$/m)
  const selected = startupSelection(['--esp-now-config', '/private/radio.json'])
  let usb = 0
  const radio = { transport: 'wireless' }
  assert.deepEqual(selectTransports(selected, { usb: () => { usb++; }, radio: file => { assert.equal(file, '/private/radio.json'); return radio } }), [radio])
  assert.equal(usb, 0)
  assert.equal(startupSelection([], { ODK_REMOTE_ESPNOW_CONFIG: '/private/radio.json' }).radioConfig, '/private/radio.json')
  assert.throws(() => startupSelection([], { ODK_REMOTE_ESPNOW_CONFIG: '' }), /configuration/)
  assert.throws(() => startupSelection(['--esp-now-config=']), /configuration/)
  assert.throws(() => startupSelection(['--esp-now-config=/a', '--plugin-selection=/b', '--trust-plugins']), /combined/)
})

const { TYPES, frames, decode, statePayload } = require('../lib/esp-now-protocol')
const { EspNowAdapter } = require('../lib/esp-now-adapter')
const config = { python: '/usr/bin/python3', serialNumber: '9C:CC:01:34:31:50', channel: 1, pmk: 'a'.repeat(32), peers: [{ mac: 'f0:9e:9e:11:23:cc', lmk: 'b'.repeat(32) }] }
const state = { v: 1, type: 'state', page: 1, pages: 2, name: 'Home', canPrev: false, canNext: true, actions: [{ id: 'open', label: 'Open' }] }
const flush = () => new Promise(resolve => setImmediate(resolve))
async function fixture(t, options = {}) {
  let callback, stopped = 0, ack = true
  const sent = []
  const adapter = new EspNowAdapter({ config, intervalMs: 10, deadlineMs: 60, ...options, sourceFactory: ({ onReceive }) => {
    callback = onReceive
    return { refresh: async () => ({ status: 'live' }), stop: async () => { stopped++ }, action: async action => {
      const frame = decode(Buffer.from(action.payload, 'base64')); sent.push(frame)
      if (ack && frame.type === TYPES.STATE && frame.part === frame.count - 1) receive(TYPES.STATE_ACK, frame.sequence)
      return { ok: true, delivery: 'mac-receipt' }
    } }
  } })
  const receive = (type, sequence = 0, payload, remote = 123, host = adapter.host, peer = config.peers[0].mac) => callback({ peer, payload: frames(type, remote, host, sequence, payload)[0].toString('base64') })
  await adapter.start(); t.after(() => adapter.stop())
  receive(TYPES.HELLO, 0, undefined, 123, 0)
  assert.equal(adapter.isConnected, false)
  receive(TYPES.HELLO)
  assert.equal(adapter.isConnected, true)
  return { adapter, receive, sent, noAck: () => { ack = false }, stopped: () => stopped }
}

test('radio frames enforce exact lengths, reserved bytes, fragment counts, and 250-byte ceiling', () => {
  const payload = Buffer.alloc(512, 65)
  const encoded = frames(TYPES.STATE, 1, 2, 3, payload)
  assert.deepEqual(encoded.map(b => b.length), [250, 250, 84])
  assert.deepEqual(Buffer.concat(encoded.map(b => decode(b).payload)), payload)
  assert.equal(encoded[0].toString('hex', 0, 24), '4f444b520104000301000000020000000300000000020000')
  for (const offset of [0, 4, 7, 22, 23]) {
    const bad = Buffer.from(encoded[0]); bad[offset] ^= 255; assert.equal(decode(bad), null)
  }
  assert.equal(decode(encoded[0].subarray(0, 249)), null)
  assert.throws(() => frames(TYPES.STATE, 1, 2, 3, Buffer.alloc(513)))
  assert.throws(() => frames(TYPES.INPUT, 1, 2, 3, Buffer.alloc(227)))
})

test('remote state bounds UTF-8 and retains exact supported action authority', () => {
  const payload = statePayload({ ...state, name: '你'.repeat(30), actions: [{ id: 'x'.repeat(32), label: 'unsupported' }, { id: 'a"b', label: '界'.repeat(8) }] })
  const remote = JSON.parse(payload)
  assert.equal(Buffer.byteLength(remote.name), 45)
  assert.deepEqual(remote.actions, [{ id: 'a"b', label: '界'.repeat(5) }])
  assert.throws(() => statePayload({ ...state, pages: 65536 }))
  assert.deepEqual(JSON.parse(statePayload({ ...state, actions: [{ id: '"'.repeat(31), label: 'Too escaped' }] })).actions, [])
})

test('only complete S3 application acknowledgement synchronizes state and enables input', async t => {
  const { adapter, receive, sent } = await fixture(t)
  const inputs = []; adapter.on('message', input => inputs.push(input))
  const input = Buffer.from(JSON.stringify({ v: 1, type: 'input', input: 'primary' }))
  receive(TYPES.INPUT, 1, input)
  assert.equal(inputs.length, 0)
  assert.equal(adapter.deviceSnapshot().remote.status, 'syncing')
  await adapter.send(state)
  assert.equal(adapter.deviceSnapshot().remote.status, 'ready')
  assert(sent.some(f => f.type === TYPES.STATE))
  receive(TYPES.INPUT, 1, input); receive(TYPES.INPUT, 1, input)
  receive(TYPES.INPUT, 2, input, 122)
  receive(TYPES.INPUT, 2, input, 123, adapter.host + 1)
  receive(TYPES.INPUT, 2, input, 123, adapter.host, '02:00:00:00:00:08')
  assert.equal(inputs.length, 1)
  receive(TYPES.INPUT, 2, Buffer.from(JSON.stringify({ v: 1, type: 'input', input: 'action', action: 'hidden' })))
  assert.equal(inputs.length, 1)
  receive(TYPES.INPUT, 2, Buffer.from(JSON.stringify({ v: 1, type: 'input', input: 'action', action: 'open' })))
  assert.equal(inputs.length, 2)
  receive(TYPES.HELLO, 0, undefined, 124, 0)
  receive(TYPES.INPUT, 3, input)
  assert.equal(adapter.isConnected, false)
  assert.equal(inputs.length, 2)
})

test('MAC delivery alone times out and disconnects without replay or USB fallback', async t => {
  const { adapter, noAck, sent } = await fixture(t)
  noAck()
  await assert.rejects(adapter.send(state), /ack-timeout/)
  assert.equal(adapter.isConnected, false)
  const count = sent.filter(f => f.type === TYPES.STATE).length
  await flush()
  assert.equal(sent.filter(f => f.type === TYPES.STATE).length, count)
})

test('heartbeat expiry blocks input and stop releases one gateway owner', async t => {
  let now = 1000
  const { adapter, receive, stopped } = await fixture(t, { now: () => now })
  await adapter.send(state)
  let inputs = 0; adapter.on('message', () => inputs++)
  now += 3501
  receive(TYPES.INPUT, 1, Buffer.from('{"v":1,"type":"input","input":"back"}'))
  assert.equal(inputs, 0)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(adapter.isConnected, false)
  await adapter.stop(); await adapter.stop()
  assert.equal(stopped(), 1)
})

test('rapid Shell state changes reach the S3 in order without losing the latest state', async t => {
  const { adapter, sent } = await fixture(t)
  await Promise.all([adapter.send(state), adapter.send({ ...state, name: 'Latest' })])
  const delivered = sent.filter(f => f.type === TYPES.STATE && f.part === 0)
  assert.equal(delivered.length, 2)
  assert.equal(JSON.parse(delivered[1].payload).name, 'Latest')
})

test('stale ACK cannot synchronize and stop cancels pending state without forwarding input', async t => {
  const { adapter, receive, noAck, sent } = await fixture(t)
  noAck()
  let synchronized = false
  const sending = adapter.send(state).then(() => { synchronized = true })
  const rejected = assert.rejects(sending, /disconnected|stopped|retired/)
  await flush()
  const current = sent.find(f => f.type === TYPES.STATE)
  receive(TYPES.STATE_ACK, current.sequence + 1)
  receive(TYPES.STATE_ACK, current.sequence, undefined, 122)
  await flush()
  assert.equal(synchronized, false)
  await adapter.stop()
  await rejected
  assert.equal(adapter.isConnected, false)
})

test('radio transport participates in the actual Bridge socket and synchronization lifecycle', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net')
  const { RemoteBridge } = require('../lib/remote-bridge')
  const { adapter, receive } = await fixture(t)
  // Give the runtime its ordinary ownership of transport start.
  await adapter.stop()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-radio-bridge-'))
  const socketPath = path.join(directory, 'bridge.sock')
  const bridge = new RemoteBridge({ adapter, socketPath, logger: { error() {} } })
  await bridge.start()
  t.after(async () => { await bridge.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  const socket = net.createConnection(socketPath), records = []
  let remaining = ''
  socket.on('data', chunk => { remaining += chunk; let newline; while ((newline = remaining.indexOf('\n')) >= 0) { records.push(JSON.parse(remaining.slice(0, newline))); remaining = remaining.slice(newline + 1) } })
  t.after(() => socket.destroy())
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  socket.write(JSON.stringify(state) + '\n')
  await new Promise(resolve => setTimeout(resolve, 10))
  receive(TYPES.HELLO)
  for (let attempt = 0; attempt < 30 && !records.some(r => r.state === 'wireless'); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert(records.some(r => r.state === 'syncing'))
  assert(records.some(r => r.state === 'wireless'))
  receive(TYPES.INPUT, 1, Buffer.from('{"v":1,"type":"input","input":"right"}'))
  for (let attempt = 0; attempt < 30 && !records.some(r => r.input === 'right'); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(records.filter(r => r.input === 'right').length, 1)
  assert.equal(bridge.pluginCatalog().filter(p => p.manifest.kind === 'transport').length, 1)
  assert.equal(bridge.pluginCatalog().find(p => p.manifest.kind === 'transport').manifest.id, 'odk.remote.transport.esp-now')
})
