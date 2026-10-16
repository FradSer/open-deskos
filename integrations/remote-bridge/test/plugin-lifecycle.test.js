'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { RemoteBridge } = require('../lib/remote-bridge')
const { RemoteBridgeHost } = require('../lib/remote-bridge-host')
const { MockTransport } = require('./mock-transport')

for (const multiple of [false, true]) {
  test(`${multiple ? 'transport host' : 'single bridge'} uses common lifecycle and releases subscriptions on restart`, async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-plugin-'))
    const transport = new MockTransport({ id: 'odk.remote.transport.fixture', transport: 'usb-cdc' })
    const options = { socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [transport] }) : new RemoteBridge({ ...options, adapter: transport })
    t.after(async () => { await bridge.stop(); await fs.promises.rm(directory, { recursive: true, force: true }) })
    await bridge.start()
    const catalog = bridge.pluginCatalog()
    assert.equal(catalog.length, 3)
    assert.ok(catalog.every(entry => entry.state === 'running' && entry.manifest.host === 'remote-bridge'))
    assert.equal(transport.listenerCount('message'), 1)
    await bridge.stop()
    assert.equal(transport.listenerCount('message'), 0)
    await bridge.start()
    assert.equal(transport.listenerCount('message'), 1)
  })

  test(`${multiple ? 'transport host' : 'single bridge'} retains transport and socket after stop failure until retry succeeds`, async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-plugin-'))
    const transport = new MockTransport({ id: 'odk.remote.transport.fixture', transport: 'usb-cdc' })
    let destroyed = 0
    let fail = true
    transport.stop = async () => { if (fail) throw Error('stop failed') }
    transport.destroy = async () => { destroyed++ }
    const options = { socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [transport] }) : new RemoteBridge({ ...options, adapter: transport })
    t.after(async () => { fail = false; await bridge.stop(); await fs.promises.rm(directory, { recursive: true, force: true }) })
    await bridge.start()
    await bridge.stop()
    assert.equal(destroyed, 0)
    assert.equal(fs.existsSync(options.socketPath), true)
    assert.equal(bridge.pluginCatalog().find(entry => entry.manifest.id === 'odk.remote.control').state, 'stopped')
    assert.ok(bridge.pluginCatalog().filter(entry => entry.manifest.id !== 'odk.remote.control').every(entry => entry.state.startsWith('cleanup-')))
    fail = false
    await bridge.stop()
    assert.equal(destroyed, 1)
    assert.equal(fs.existsSync(options.socketPath), false)
    assert.equal(transport.listenerCount('message'), 0)
  })

  test(`${multiple ? 'transport host' : 'single bridge'} retains server and socket ownership across cleanup failures`, async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-cleanup-'))
    const transport = new MockTransport({ id: 'odk.remote.transport.fixture', transport: 'usb-cdc' })
    const options = { socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [transport] }) : new RemoteBridge({ ...options, adapter: transport })
    const lstat = fs.promises.lstat
    let close
    let server
    t.after(async () => {
      fs.promises.lstat = lstat
      if (server && close) server.close = close
      if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await bridge.stop()
      await fs.promises.rm(directory, { recursive: true, force: true })
    })
    await bridge.start()
    server = bridge.server
    close = server.close
    server.close = callback => callback(Error('server busy'))
    await bridge.stop()
    assert.equal(bridge.server, server)
    assert.equal(server.listening, true)
    assert.equal(bridge.ownsSocket, true)
    server.close = close
    fs.promises.lstat = async target => {
      if (target === options.socketPath) throw Object.assign(Error('socket cleanup refused'), { code: 'EACCES' })
      return lstat(target)
    }
    await bridge.stop()
    assert.equal(server.listening, false)
    assert.equal(bridge.server, null)
    assert.equal(bridge.ownsSocket, true)
    fs.promises.lstat = lstat
    await bridge.stop()
    assert.equal(bridge.ownsSocket, false)
    assert.equal(fs.existsSync(options.socketPath), false)
  })
}

test('transport removal switches to an available fallback without closing the listener', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-plugin-'))
  const usb = new MockTransport({ id: 'odk.remote.transport.usb', priority: 100, transport: 'usb-cdc' })
  const wireless = new MockTransport({ id: 'odk.remote.transport.wireless', priority: 50, transport: 'wireless' })
  const bridge = new RemoteBridgeHost({ transports: [usb, wireless], socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } })
  t.after(async () => { await bridge.stop(); await fs.promises.rm(directory, { recursive: true, force: true }) })
  await bridge.start()
  wireless.isConnected = true
  wireless.emit('connected', { transport: 'wireless' })
  usb.isConnected = true
  usb.emit('connected', { transport: 'usb-cdc' })
  await bridge.setTransportEnabled(usb.manifest.id, false)
  assert.equal(bridge.activeTransport, wireless)
  assert.equal(bridge.linkState.state, 'wireless')
  assert.equal(bridge.server.listening, true)
  assert.equal(usb.listenerCount('message'), 0)
  await bridge.setTransportEnabled(usb.manifest.id, true)
  assert.equal(usb.listenerCount('message'), 1)
  usb.emit('connected', { transport: 'usb-cdc' })
  assert.equal(bridge.activeTransport, usb)
})

test('the common kernel is loaded in the immutable release layout', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-release-'))
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }))
  const base = path.join(directory, 'integrations', 'remote-bridge', 'lib')
  await fs.promises.mkdir(base, { recursive: true })
  await fs.promises.cp(path.resolve(__dirname, '../../../runtime/shell/src'), path.join(directory, 'src'), { recursive: true })
  const { loadPluginHost } = require('../lib/plugin-runtime')
  assert.equal(typeof loadPluginHost(base).createPluginHost, 'function')
  await fs.promises.cp(path.resolve(__dirname, '../lib'), base, { recursive: true })
  const { RemoteBridge: ReleaseBridge } = require(path.join(base, 'remote-bridge.js'))
  const adapter = new MockTransport({ id: 'odk.remote.transport.release' })
  const bridge = new ReleaseBridge({ adapter, socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } })
  t.after(() => bridge.stop())
  await bridge.start()
  assert.ok(bridge.pluginCatalog().every(entry => entry.state === 'running'))
})

test('a retired transport cannot publish another transport as synchronized', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-plugin-'))
  const wireless = new MockTransport({ id: 'odk.remote.transport.wireless', priority: 50, transport: 'wireless' })
  const usb = new MockTransport({ id: 'odk.remote.transport.usb', priority: 100, transport: 'usb-cdc' })
  let finishWireless
  let finishUsb
  const wirelessSend = new Promise(resolve => { finishWireless = resolve })
  const usbSend = new Promise(resolve => { finishUsb = resolve })
  wireless.send = () => wirelessSend
  usb.send = () => usbSend
  const bridge = new RemoteBridgeHost({ transports: [usb, wireless], socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } })
  t.after(async () => { finishWireless(); finishUsb(); await bridge.stop(); await fs.promises.rm(directory, { recursive: true, force: true }) })
  await bridge.start()
  bridge.latestShellState = { v: 1, type: 'state', page: 1, pages: 1, name: 'Home', canPrev: false, canNext: false }
  wireless.emit('connected', { transport: 'wireless' })
  usb.emit('connected', { transport: 'usb-cdc' })
  finishWireless()
  await new Promise(setImmediate)
  assert.equal(bridge.linkState.state, 'syncing')
  finishUsb()
  await new Promise(setImmediate)
  assert.equal(bridge.linkState.state, 'usb')
})
