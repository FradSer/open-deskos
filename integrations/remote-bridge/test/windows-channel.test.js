'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { resolveSocketPath } = require('../lib/remote-bridge')
const { createRemoteBridgeClient, resolveRemoteBridgeSocketPath } = require('../../../runtime/shell/src/remote-bridge-client')
const { resolveShellHost } = require('../../../runtime/shell/src/platform')
const host = resolveShellHost({ platform: 'win32', arch: 'x64', env: { LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local' } })

class Socket extends EventEmitter {
  constructor() { super(); this.writes = []; this.destroyed = false; this.connecting = false }
  write(value) { this.writes.push(String(value)); return true }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close') } }
  setEncoding() {}
}

test('Windows Bridge and Shell resolve the same host pipe without XDG_RUNTIME_DIR', () => {
  assert.equal(resolveSocketPath({}, host), host.endpoint('remote-bridge'))
  assert.equal(resolveRemoteBridgeSocketPath({}, host), host.endpoint('remote-bridge'))
})

test('Windows client authenticates before state and separate runtime diagnosis', async () => {
  const sockets = []
  const client = createRemoteBridgeClient({ socketPath: host.endpoint('remote-bridge'), host,
    readChannelToken: () => 'fixture-token', diagnosisTimeoutMs: 10,
    createConnection() { const socket = new Socket(); sockets.push(socket); return socket } })
  client.start()
  client.publishPageState({ page: 1, pages: 1, name: 'Home' })
  sockets[0].emit('connect')
  assert.deepEqual(JSON.parse(sockets[0].writes[0]), { v: 1, token: 'fixture-token' })
  assert.equal(JSON.parse(sockets[0].writes[1]).type, 'state')
  const pending = client.diagnose()
  sockets[1].emit('connect')
  assert.deepEqual(JSON.parse(sockets[1].writes[0]), { v: 1, token: 'fixture-token' })
  assert.equal(JSON.parse(sockets[1].writes[1]).type, 'runtime_diagnose')
  client.stop()
  await pending
  const writes = sockets.map(socket => socket.writes.length)
  for (const socket of sockets) socket.emit('connect')
  assert.deepEqual(sockets.map(socket => socket.writes.length), writes)
})

test('Windows missing-token admission opens no connection and stop cancels retry', () => {
  let connections = 0, retry = null, cleared = false
  const client = createRemoteBridgeClient({ socketPath: host.endpoint('remote-bridge'), host,
    readChannelToken: () => '', createConnection() { connections++; return new Socket() },
    setTimeoutFn(fn) { retry = fn; return 1 }, clearTimeoutFn() { cleared = true } })
  client.start()
  assert.equal(connections, 0)
  assert.equal(client.getLinkState(), 'disconnected')
  assert.equal(typeof retry, 'function')
  client.stop(); retry()
  assert.equal(connections, 0)
  assert.equal(cleared, true)
})


const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { once } = require('node:events')
const { RemoteBridge } = require('../lib/remote-bridge')
const { RemoteBridgeHost } = require('../lib/remote-bridge-host')
const { listenChannel, handshakeFrame } = require('../../../runtime/shell/src/local-channel')
const { listenOdkData } = require('../../../runtime/shell/src/odk-data-control')
const { createBridgeDeviceSource } = require('../../../runtime/shell/src/device-bridge-source')
const { createUserAppDevices } = require('../../../runtime/shell/src/user-app-devices')
const logger = { error() {} }
const flush = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw Error('Offline Windows channel fixture deadline')
}
class Adapter extends EventEmitter {
  constructor() { super(); this.starts = 0; this.stops = 0; this.actions = []; this.sent = [] }
  async start() { this.starts++ }
  async stop() { this.stops++ }
  async send(state) { this.sent.push(state) }
  deviceSnapshot() { return { status: 'live', gateway: { status: 'live', serialNumber: 'fixture-c6' },
    remote: { mac: '02:00:00:00:00:01', status: 'ready' }, peers: [], events: [] } }
  async deviceAction(action) { this.actions.push(action); if (action.type === 'send') return new Promise(resolve => { this.release = resolve }); return { ok: true, delivery: 'usb-reply' } }
}

for (const multiple of [false, true]) {
  const label = multiple ? 'transport host' : 'single Bridge'
  async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owb-'))
    const backend = path.join(root, 'data.sock'), control = path.join(root, 'control.sock')
    const windowsHost = { ...host, stateDir: root }
    const observed = []
    const channel = async options => {
      observed.push({ endpoint: options.endpoint, platform: options.platform, stateDir: options.stateDir, maxConnections: options.maxConnections })
      assert.equal(options.endpoint, host.endpoint('remote-bridge'))
      // This is a synthetic Windows branch over a local test socket, not native pipe evidence.
      return listenChannel({ ...options, endpoint: backend })
    }
    const controlListener = options => {
      observed.push({ endpoint: options.endpoint, platform: options.platform, stateDir: options.stateDir, maxConnections: options.maxConnections })
      assert.equal(options.endpoint, host.endpoint('remote-plugin-control'))
      return listenOdkData({ ...options, endpoint: control })
    }
    const adapter = new Adapter()
    const options = { host: windowsHost, listenChannel: channel, listenControl: controlListener, logger }
    const make = selected => multiple ? new RemoteBridgeHost({ ...options, transports: [selected] }) : new RemoteBridge({ ...options, adapter: selected })
    const bridge = make(adapter)
    t.after(async () => { await bridge.stop(); await fs.rm(root, { recursive: true, force: true }) })
    await bridge.start()
    const token = (await fs.readFile(path.join(root, 'local-channel.token'), 'utf8')).trim()
    return { root, backend, control, windowsHost, observed, adapter, bridge, make, token }
  }

  test(`${label}: Windows auth hides state, and Devices plus packages share one worker`, async t => {
    const f = await fixture(t)
    assert.equal(f.adapter.starts, 1)
    assert.deepEqual(f.observed.map(item => item.platform), ['win32', 'win32'])
    assert.ok(f.observed.every(item => item.stateDir === f.root && item.maxConnections === 32))
    for (const endpoint of [f.backend, f.control]) for (const firstLine of ['{"v":1,"type":"state"}\n', handshakeFrame('wrong-token'), 'x'.repeat(514) + '\n']) {
      const socket = net.createConnection(endpoint); const data = []
      socket.on('data', chunk => data.push(chunk)); socket.on('error', () => {})
      await once(socket, 'connect')
      const closed = new Promise(resolve => socket.once('close', resolve))
      socket.write(firstLine); await closed
      assert.equal(data.length, 0)
    }
    const controlSocket = net.createConnection(f.control); let controlBytes = ''
    t.after(() => controlSocket.destroy()); controlSocket.on('data', chunk => { controlBytes += chunk })
    await once(controlSocket, 'connect')
    const controlEnded = once(controlSocket, 'end')
    controlSocket.write(handshakeFrame(f.token) + JSON.stringify({ v: 1, id: 'fixture-inventory', command: 'inventory' }) + '\n')
    await controlEnded
    const inventory = JSON.parse(controlBytes)
    assert.equal(inventory.ok, true); assert.equal(inventory.scope, 'remote-bridge')
    assert.ok(inventory.plugins.some(plugin => plugin.pluginId === 'odk.remote.control'))
    const socket = net.createConnection(f.backend); let bytes = ''
    socket.on('data', chunk => { bytes += chunk }); socket.on('error', () => {})
    t.after(() => socket.destroy()); await once(socket, 'connect'); await flush()
    assert.equal(bytes, '')
    socket.write(handshakeFrame(f.token) + JSON.stringify({ v: 1, type: 'state', page: 1, pages: 1, name: 'Home', canPrev: false, canNext: false }) + '\n')
    await waitFor(() => f.bridge.latestShellState !== null)
    assert.equal(f.bridge.latestShellState.name, 'Home')
    await waitFor(() => bytes.includes('disconnected'))
    const client = createRemoteBridgeClient({ socketPath: host.endpoint('remote-bridge'), host: f.windowsHost,
      readChannelToken: () => f.token, createConnection: () => net.createConnection(f.backend) })
    const facade = createBridgeDeviceSource({ client, authorize: () => true })
    t.after(() => { facade.stop(); client.stop() }); client.start()
    await waitFor(() => facade.snapshot().status === 'live')
    assert.deepEqual(await facade.action({ type: 'ping' }), { ok: true, delivery: 'usb-reply' })
    const app = { id: 'fixture', kind: 'app', revision: 'a'.repeat(32), devices: { gateway: true } }
    const broker = createUserAppDevices({ gateway: facade, isActive: () => true,
      store: { getContent: async () => ({ ok: true, app }) },
      readGrants: async () => ({ schemaVersion: 1, grants: [{ appId: app.id, revision: app.revision, gateway: true }] }) })
    t.after(() => broker.close())
    assert.equal((await broker.read({ appId: app.id, revision: app.revision })).gateway.serialNumber, 'fixture-c6')
    assert.equal(f.adapter.starts, 1)
    assert.equal((await client.diagnose())[0].state, 'available')
    const pending = client.deviceAction({ type: 'send', peer: '02:00:00:00:00:02', payload: 'eA==' })
    await waitFor(() => typeof f.adapter.release === 'function')
    client.stop()
    assert.deepEqual(await pending, { ok: false, error: 'delivery-unknown' })
    f.adapter.release({ ok: true, delivery: 'mac-receipt' }); client.start()
    await waitFor(() => client.getDeviceSnapshot().status === 'live')
    assert.equal(f.adapter.actions.filter(action => action.type === 'send').length, 1)
    assert.equal(f.adapter.starts, 1)
    client.stop()
  })

  test(`${label}: Windows live owner prevents a second worker and preserves first owner`, async t => {
    const f = await fixture(t)
    const secondAdapter = new Adapter(), second = f.make(secondAdapter)
    await assert.rejects(second.start(), /already listening|cannot identify|already in use/)
    assert.equal(secondAdapter.starts, 0)
    await second.stop()
    assert.equal(f.adapter.starts, 1)
    assert.equal(f.bridge.started, true)
  })

  test(`${label}: Windows startup stop closes a late channel before worker admission`, async () => {
    let resolveChannel, closed = 0
    const adapter = new Adapter()
    const options = { host, disabled: ['odk.remote.control'], logger,
      listenChannel: () => new Promise(resolve => { resolveChannel = resolve }) }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [adapter] }) : new RemoteBridge({ ...options, adapter })
    const start = bridge.start()
    await waitFor(() => resolveChannel)
    const stop = bridge.stop()
    resolveChannel({ close: async () => { closed++ } })
    await Promise.all([start, stop]); await bridge.stop()
    assert.equal(closed, 1)
    assert.equal(adapter.starts, 0)
    assert.equal(bridge.channel, null)
  })

  test(`${label}: Windows token initialization failure never starts a worker`, async () => {
    const adapter = new Adapter()
    const options = { host, disabled: ['odk.remote.control'], logger,
      listenChannel: async () => { throw Error('fixture token initialization failed') } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [adapter] }) : new RemoteBridge({ ...options, adapter })
    await assert.rejects(bridge.start(), /token initialization failed/)
    assert.equal(adapter.starts, 0)
    await bridge.stop()
  })

  test(`${label}: a failed Windows control listener prevents worker admission and drains data listener`, async () => {
    const adapter = new Adapter(); let closed = 0
    const options = { host, logger,
      listenChannel: async () => ({ close: async () => { closed++ } }),
      listenControl: async () => { throw Error('fixture control occupied') } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [adapter] }) : new RemoteBridge({ ...options, adapter })
    await assert.rejects(bridge.start(), /control occupied/)
    assert.equal(adapter.starts, 0)
    assert.equal(closed, 1)
    assert.equal(bridge.channel, null)
    await bridge.stop()
  })


  test(`${label}: stop during Windows control bind drains both late listeners once`, async () => {
    const adapter = new Adapter(); let resolveControl, dataClosed = 0, controlClosed = 0
    const options = { host, logger,
      listenChannel: async () => ({ close: async () => { dataClosed++ } }),
      listenControl: () => new Promise(resolve => { resolveControl = resolve }) }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [adapter] }) : new RemoteBridge({ ...options, adapter })
    const start = bridge.start()
    await waitFor(() => resolveControl)
    const stop = bridge.stop()
    resolveControl({ close: async () => { controlClosed++ } })
    await Promise.all([start, stop]); await bridge.stop()
    assert.equal(adapter.starts, 0)
    assert.equal(dataClosed, 1); assert.equal(controlClosed, 1)
    assert.equal(bridge.channel, null)
  })

}


test('Windows startup requires the selected C6 config and never selects the USB Remote adapter', () => {
  const { startupSelection, selectTransports } = require('../lib/main')
  assert.throws(() => startupSelection([], {}, 'win32'), /Windows.*ESP-NOW.*configuration/)
  const file = 'C:\\private\\gateway.json'
  const selection = startupSelection(['--esp-now-config', file], {}, 'win32')
  let usb = 0, radio = 0
  const adapter = {}
  assert.deepEqual(selectTransports(selection, { usb: () => { usb++; return {} }, radio: selected => { radio++; assert.equal(selected, file); return adapter } }), [adapter])
  assert.equal(usb, 0); assert.equal(radio, 1)
  assert.throws(() => startupSelection(['--esp-now-config', 'relative.json'], {}, 'win32'), /absolute/)
})


test('Windows channel caps pending and authenticated connections together', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owb-cap-'))
  const endpoint = path.join(root, 'pipe.sock')
  let admitted = 0
  const channel = await listenChannel({ endpoint, platform: 'win32', token: 'fixture-token', maxConnections: 1,
    onConnection(socket) { admitted++; socket.on('data', () => {}) } })
  const sockets = []
  t.after(async () => { for (const socket of sockets) socket.destroy(); await channel.close(); await fs.rm(root, { recursive: true, force: true }) })
  const open = async () => { const socket = net.createConnection(endpoint); socket.on('error', () => {}); sockets.push(socket); await once(socket, 'connect'); await flush(); return socket }
  const first = await open()
  async function expectRejected() {
    const next = await open(); let timer
    const closed = new Promise(resolve => next.once('close', () => resolve(true)))
    const result = await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => resolve(false), 250) })])
    clearTimeout(timer); next.destroy(); assert.equal(result, true, 'connection cap must act before the one-second auth timeout')
  }
  await expectRejected()
  first.write(handshakeFrame('fixture-token'))
  await waitFor(() => admitted === 1)
  await expectRejected()
  first.destroy(); await flush()
  const replacement = await open(); replacement.write(handshakeFrame('fixture-token'))
  await waitFor(() => admitted === 2)
})
