'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EspNowAdapter } = require('../lib/esp-now-adapter')
const { TYPES, frames } = require('../lib/esp-now-protocol')
const config = { python: '/usr/bin/python3', serialNumber: 'C6', channel: 1, pmk: 'a'.repeat(32), remoteMac: '02:00:00:00:00:01', peers: [{ mac: '02:00:00:00:00:01', lmk: 'b'.repeat(32) }, { mac: '02:00:00:00:00:02', lmk: 'c'.repeat(32) }] }
const flush = () => new Promise(resolve => setImmediate(resolve))
test('shared gateway separates remote authority, generic events, and safe cached status', async t => {
  let callback, spawns = 0, now = 1000, status = 'live'
  const sends = []
  const adapter = new EspNowAdapter({ config, now: () => now, intervalMs: 5, sourceFactory: ({ onReceive }) => {
    spawns++; callback = onReceive
    return { refresh: async () => ({ status, mac: '02:00:00:00:00:03', firmware: '0.1.0', channel: 1, receivedAt: now }), action: async action => { sends.push(action); return { ok: true, delivery: 'mac-receipt' } }, stop: async () => {} }
  } })
  await adapter.start(); t.after(() => adapter.stop())
  assert.equal(adapter.deviceSnapshot().gateway.status, 'live')
  assert.equal(adapter.deviceSnapshot().remote.status, 'disconnected')
  const events = []; adapter.on('device-event', event => events.push(event))
  callback({ peer: config.remoteMac, payload: frames(TYPES.HELLO, 10, adapter.host, 0)[0].toString('base64') })
  assert.equal(adapter.deviceSnapshot().remote.status, 'syncing')
  callback({ peer: config.peers[1].mac, payload: Buffer.from('sensor').toString('base64') })
  assert.equal(events.length, 1)
  assert.equal(events[0].peer, config.peers[1].mac)
  assert.equal(adapter.deviceSnapshot().peers[1].status, 'live')
  assert.deepEqual(await adapter.deviceAction({ type: 'send', peer: config.remoteMac, payload: 'eA==' }), { ok: false, error: 'reserved-peer' })
  assert.deepEqual(await adapter.deviceAction({ type: 'send', peer: config.peers[1].mac, payload: Buffer.from('ODKRfake').toString('base64') }), { ok: false, error: 'reserved-protocol' })
  assert.deepEqual(await adapter.deviceAction({ type: 'send', peer: config.peers[1].mac, payload: 'eA==' }), { ok: true, delivery: 'mac-receipt' })
  assert.equal(spawns, 1)
  assert(!JSON.stringify(adapter.deviceSnapshot()).includes(config.pmk))
  status = 'unavailable'; now += 4000
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(adapter.deviceSnapshot().remote.status, 'disconnected')
  assert.deepEqual(adapter.deviceSnapshot().events, [])
  assert.equal(adapter.deviceSnapshot().peers[1].status, 'stale')
  assert.deepEqual(await adapter.deviceAction({ type: 'ping' }), { ok: false, error: 'unavailable' })
  await flush()
})

test('device requests correlate on the private Bridge listener without adding a worker', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), net = require('node:net')
  const { RemoteBridge } = require('../lib/remote-bridge')
  const { EventEmitter } = require('node:events')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-shared-'))
  const adapter = new EventEmitter(); let starts = 0, actions = 0
  Object.assign(adapter, { start: async () => { starts++ }, stop: async () => {}, deviceSnapshot: () => ({ status: 'live', peers: [], events: [] }), deviceAction: async action => { actions++; return { ok: true, delivery: 'usb-reply' } } })
  const bridge = new RemoteBridge({ adapter, socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } })
  await bridge.start()
  t.after(async () => { await bridge.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  const socket = net.createConnection(bridge.socketPath), records = []; let pending = ''
  t.after(() => socket.destroy())
  socket.on('data', chunk => { pending += chunk; let end; while ((end = pending.indexOf('\n')) >= 0) { records.push(JSON.parse(pending.slice(0, end))); pending = pending.slice(end + 1) } })
  await new Promise(resolve => socket.once('connect', resolve))
  const requestId = '00000000-0000-0000-0000-000000000001'
  socket.write(JSON.stringify({ v: 1, type: 'device_request', requestId, action: { type: 'status' } }) + '\n')
  for (let i = 0; i < 30 && !records.some(record => record.type === 'device_reply'); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(records.find(record => record.type === 'device_reply').requestId, requestId)
  assert.equal(records.find(record => record.type === 'device_reply').result.snapshot.status, 'live')
  assert.equal(actions, 0); assert.equal(starts, 1)
  adapter.emit('device-event', { peer: '02:00:00:00:00:02', payload: 'eA==', receivedAt: 1000 })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(records.filter(record => record.type === 'device_event').length, 1)
})

test('device channel bounds in-flight requests and closes slow clients', async () => {
  const { respondDeviceRequest, writeDeviceRecord } = require('../lib/device-channel')
  const responses = []; let destroyed = false, release
  const socket = { writableLength: 0, destroyed: false, write(line) { responses.push(JSON.parse(line)) }, destroy() { destroyed = true } }
  let calls = 0
  const adapter = { deviceAction: () => { calls++; return new Promise(resolve => { release = resolve }) } }
  for (let i = 0; i < 9; i++) respondDeviceRequest(socket, { v: 1, type: 'device_request', requestId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, action: { type: 'ping' } }, adapter)
  await flush(); assert.equal(calls, 8)
  assert.equal(responses[0].result.error, 'busy')
  release({ ok: true }); await flush()
  socket.writableLength = 65536
  writeDeviceRecord(socket, { v: 1, type: 'device_event', event: {} })
  assert.equal(destroyed, true)
})
