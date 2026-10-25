'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { createDeviceGatewaySource, createLineDecoder, validateAction } = require('../src/device-gateway-source')

function worker({ firmware = '0.1.0' } = {}) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.kill = () => { queueMicrotask(() => child.emit('close', 0)); return true }
  const requests = []
  let session = '1234abcd'
  let respond = true
  const decode = createLineDecoder(record => {
    requests.push(record)
    if (!respond) return
    const reply = record.type === 'hello' || record.type === 'status'
      ? { v: 1, id: record.id, type: record.type, board: 'm5stack-nanoc6', firmware, session, mac: '02:11:22:33:44:55', channel: 1, peers: 0, radio: true }
      : { v: 1, id: record.id, type: record.type, ok: true }
    queueMicrotask(() => child.stdout.write(JSON.stringify(reply) + '\n'))
  })
  child.stdin.on('data', bytes => decode(bytes))
  return { child, requests, reboot: () => { session = '8765dcba' }, silence: () => { respond = false } }
}

test('unconfigured sources never spawn a worker', async () => {
  const source = createDeviceGatewaySource({ spawn: () => assert.fail('unexpected spawn') })
  assert.equal((await source.refresh()).status, 'unconfigured')
  await source.stop()
})

test('decoder bounds bytes, rejects UTF-8, and discards an entire oversized record', () => {
  const records = []
  const decode = createLineDecoder(value => records.push(value))
  decode(Buffer.alloc(600, 120))
  decode(Buffer.from('{"v":1}\n'))
  decode(Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10]))
  decode(Buffer.from('{"v":2}\n{"v":1,"type":"ping"}\n'))
  assert.deepEqual(records, [{ v: 1, type: 'ping' }])
})

test('one handshake is shared and snapshots contain actual firmware data', async t => {
  const w = worker()
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => w.child })
  t.after(() => source.stop())
  const values = await Promise.all([source.refresh(), source.refresh()])
  assert.ok(values.every(v => v.status === 'live' && v.mac === '02:11:22:33:44:55'))
  assert.equal(w.requests.filter(r => r.type === 'hello').length, 1)
  assert.equal((await source.action({ type: 'ping' })).ok, true)
  assert.equal((await source.action({ type: 'configure', pmk: 'secret' })).error, 'invalid-action')
})

test('disconnect cancels pending requests and refresh uses a fresh worker', async t => {
  const a = worker(); const b = worker(); let calls = 0
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => (++calls === 1 ? a.child : b.child), timeoutMs: 80 })
  t.after(() => source.stop())
  await source.refresh()
  a.silence()
  const pending = source.action({ type: 'ping' })
  await new Promise(resolve => setImmediate(resolve))
  a.child.emit('close', 1)
  assert.equal((await pending).ok, false)
  assert.equal((await source.refresh()).status, 'live')
  assert.equal(calls, 2)
  assert.equal(b.requests.filter(r => r.type === 'ping').length, 0)
})

test('invalid firmware and request deadlines cannot leave live state', async t => {
  const w = worker(); w.silence()
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => w.child, timeoutMs: 20 })
  t.after(() => source.stop())
  const pending = source.refresh()
  await new Promise(resolve => setImmediate(resolve))
  w.child.stdout.write(JSON.stringify({ v: 1, id: w.requests[0].id, type: 'hello', board: 'other', radio: true }) + '\n')
  assert.notEqual((await pending).status, 'live')
})

test('send action validates unicast identity and payload before transport', () => {
  assert.equal(validateAction({ type: 'send', peer: 'ff:ff:ff:ff:ff:ff', payload: 'eA==' }), false)
  assert.equal(validateAction({ type: 'send', peer: '02:11:22:33:44:55', payload: Buffer.alloc(251).toString('base64') }), false)
  assert.equal(validateAction({ type: 'send', peer: '02:11:22:33:44:55', payload: 'eA==' }), true)
  assert.equal(validateAction({ type: 'ping', command: 'arbitrary' }), false)
})

test('untrusted callers cannot start device I/O', async () => {
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => assert.fail('unauthorized I/O') })
  assert.deepEqual(await source.dispatch({}, { type: 'status' }), { ok: false, error: 'unauthorized' })
  await source.stop()
})

test('compatible protocol accepts an independent firmware patch version', async t => {
  const w = worker({ firmware: '0.1.1' })
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => w.child })
  t.after(() => source.stop())
  const value = await source.refresh()
  assert.equal(value.status, 'live')
  assert.equal(value.firmware, '0.1.1')
})

test('missing replies reach a deadline and shutdown rejects new work', async () => {
  const w = worker(); w.silence()
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => w.child, timeoutMs: 20 })
  assert.equal((await source.refresh()).status, 'unavailable')
  await source.stop()
  assert.equal((await source.action({ type: 'ping' })).ok, false)
})

test('radio events require the configured peer and current firmware session', async t => {
  const w = worker()
  const peer = '02:11:22:33:44:66'
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1', pmk: '11'.repeat(16), peers: [{ mac: peer, lmk: '22'.repeat(16) }] }, spawn: () => w.child })
  t.after(() => source.stop())
  await source.refresh()
  for (const record of [
    { peer, session: 'old-boot' },
    { peer: '02:11:22:33:44:77', session: '1234abcd' },
    { peer, session: '1234abcd' },
  ]) w.child.stdout.write(JSON.stringify({ v: 1, type: 'rx', payload: 'eA==', ...record }) + '\n')
  assert.equal(source.snapshot().events.length, 1)
  assert.equal((await source.action({ type: 'send', peer: '02:11:22:33:44:77', payload: 'eA==' })).error, 'peer-not-granted')
  assert.deepEqual(await source.action({ type: 'send', peer, payload: 'eA==' }), { ok: true, delivery: 'mac-receipt' })
})


test('gateway reboot restores volatile encrypted peers before accepting current events', async t => {
  const w = worker(), events = []
  const peer = '02:11:22:33:44:66'
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1', pmk: '11'.repeat(16), peers: [{ mac: peer, lmk: '22'.repeat(16) }] }, spawn: () => w.child, onReceive: event => events.push(event) })
  t.after(() => source.stop())
  await source.refresh()
  w.reboot()
  assert.equal((await source.refresh()).session, '8765dcba')
  assert.equal(w.requests.filter(r => r.type === 'configure').length, 2)
  assert.equal(w.requests.filter(r => r.type === 'peer').length, 2)
  for (const session of ['1234abcd', '8765dcba']) w.child.stdout.write(JSON.stringify({ v: 1, type: 'rx', session, peer, payload: 'YQ==' }) + '\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].payload, 'YQ==')
})

test('private gateway configuration rejects public files, symlinks and invalid peer grants', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
  const { loadConfig, validateConfig } = require('../src/device-gateway-source')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-gateway-config-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'gateway.json')
  const config = { python: '/usr/bin/python3', serialNumber: '9C:CC:01:34:31:50', pmk: '11'.repeat(16), peers: [{ mac: '02:11:22:33:44:55', lmk: '22'.repeat(16) }] }
  await fs.writeFile(file, JSON.stringify(config), { mode: 0o600 })
  assert.equal(loadConfig(file).serialNumber, config.serialNumber)
  if (process.platform !== 'win32') {
    await fs.chmod(file, 0o644); assert.throws(() => loadConfig(file), /private/)
    await fs.chmod(file, 0o600)
    const link = path.join(dir, 'alias.json'); await fs.symlink(file, link)
    assert.throws(() => loadConfig(link))
  }
  assert.throws(() => validateConfig({ ...config, peers: [...config.peers, ...config.peers] }), /invalid/)
  assert.throws(() => validateConfig({ ...config, channel: 12 }), /invalid/)
  assert.throws(() => validateConfig({ ...config, unknown: true }), /invalid/)
})

test('failed handshake retains its worker until close before another exclusive open', async t => {
  const w = worker({ firmware: 'invalid' })
  let spawned = 0, killed = 0
  w.child.kill = () => { killed++; return true }
  const source = createDeviceGatewaySource({ config: { python: '/python', serialNumber: 'USB-1' }, spawn: () => { spawned++; return w.child } })
  t.after(async () => { const stopped = source.stop(); w.child.emit('close', 0); await stopped })
  assert.equal((await source.refresh()).status, 'unavailable')
  await source.refresh()
  assert.equal(spawned, 1)
  assert(killed >= 1)
  w.child.emit('close', 0)
  await source.refresh()
  assert.equal(spawned, 2)
})
