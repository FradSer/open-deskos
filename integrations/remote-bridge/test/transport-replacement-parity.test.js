'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const { once } = require('node:events')
const { spawn } = require('node:child_process')
const { RemoteBridgeHost } = require('../lib/remote-bridge-host')
const { RemoteBridge } = require('../lib/remote-bridge')
const { MockTransport } = require('./mock-transport')
const { loadBridgeReplacements, transportPlaceholder } = require('../lib/development-plugins')
const { createJsonLineReader } = require('../lib/json-line-reader')

function declaration(id, priority, transport) {
  return { schemaVersion: 1, id, name: id, version: '2.0.0', host: 'remote-bridge', kind: 'transport',
    provides: [{ interface: `odk:remote/transport/${id}/v1` }], requires: [{ interface: 'odk:remote/listener/v1' }], permissions: [], priority, transport }
}

async function fixture(t) {
  const directory = await fs.mkdtemp('/tmp/odk-bridge-parity-')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const entry = path.join(directory, 'transport.cjs')
  const selection = path.join(directory, 'selection.json')
  const manifests = [declaration('odk.remote.transport.usb-cdc', 100, 'usb-cdc'), declaration('odk.remote.transport.fixture', 50, 'wireless')]
  await fs.writeFile(entry, `const { EventEmitter } = require('node:events'); exports.created = [];
    exports.create = (ctx, manifest) => {
      const item = new EventEmitter(); item.manifest = manifest; item.priority = manifest.priority; item.transport = manifest.transport;
      item.isConnected = false; item.sent = []; item.stops = 0; item.destroys = 0; item.starts = 0;
      item.start = async () => { item.starts++ };
      item.stop = async () => { item.stops++; item.isConnected = false };
      item.destroy = async () => { item.destroys++ };
      item.send = async record => { item.sent.push(record) };
      exports.created.push(item); return item;
    };`)
  await fs.writeFile(selection, JSON.stringify({ schemaVersion: 1, replacements: manifests.map(manifest => ({ manifest, entry })) }))
  return { directory, entry, selection, manifests }
}

async function clientAt(socketPath) {
  const socket = net.createConnection(socketPath)
  await once(socket, 'connect')
  const queued = []
  const waiters = []
  const reader = createJsonLineReader(line => {
    const record = JSON.parse(line)
    const waiting = waiters.shift()
    if (waiting) waiting(record)
    else queued.push(record)
  })
  socket.on('data', chunk => reader.push(chunk))
  const next = () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiters.push(resolve))
  return { socket, next, async until(type) {
    for (;;) { const record = await next(); if (record.type === type) return record }
  } }
}

for (const external of [false, true]) {
  test(`${external ? 'external factories' : 'existing transports'} preserve input, USB priority, fallback, and restart`, { timeout: 10000 }, async t => {
    const setup = await fixture(t)
    const replacements = external ? loadBridgeReplacements(setup.selection, { trusted: true }) : []
    const transports = external ? replacements.map(transportPlaceholder)
      : setup.manifests.map(manifest => new MockTransport({ id: manifest.id, priority: manifest.priority, transport: manifest.transport }))
    const bridge = new RemoteBridgeHost({ transports, replacementPlugins: replacements, socketPath: path.join(setup.directory, 'bridge.sock'), logger: { error() {} } })
    t.after(() => bridge.stop())
    await bridge.start()
    const [usb, wireless] = bridge.transports
    const client = await clientAt(bridge.socketPath)
    t.after(() => client.socket.destroy())
    await client.next()
    wireless.isConnected = true
    wireless.emit('connected', { transport: 'wireless' })
    usb.isConnected = true
    usb.emit('connected', { transport: 'usb-cdc' })
    const state = { v: 1, type: 'state', name: 'Home', page: 1, pages: 1, canPrev: false, canNext: false }
    client.socket.write(JSON.stringify(state) + '\n')
    while ((await client.until('link')).state !== 'usb') {}
    assert.equal(bridge.activeTransport, usb)
    assert.deepEqual(usb.sent.at(-1), { ...state, link: 'wired' })
    for (const input of ['left', 'right', 'up', 'down', 'primary', 'secondary', 'back', 'mic', 'action']) {
      const record = { v: 1, type: 'input', input, ...(input === 'action' ? { action: 'test-action' } : {}) }
      usb.emit('message', record)
      assert.deepEqual(await client.until('input'), record)
    }
    const server = bridge.server
    await bridge.setTransportEnabled(usb.manifest.id, false)
    assert.equal(bridge.server, server)
    assert.equal(server.listening, true)
    assert.equal(bridge.activeTransport, wireless)
    assert.deepEqual(wireless.sent.at(-1), { ...state, link: 'wireless' })
    assert.equal(usb.listenerCount('message'), 0)
    usb.emit('message', { v: 1, type: 'input', input: 'back' })
    const sentinel = { v: 1, type: 'navigate', direction: 'next' }
    wireless.emit('message', sentinel)
    for (;;) {
      const record = await client.next()
      if (record.type === 'link') continue
      assert.deepEqual(record, sentinel)
      break
    }
    await bridge.setTransportEnabled(usb.manifest.id, true)
    const current = bridge.transports[0]
    if (external) {
      assert.notEqual(current, usb)
      assert.equal(usb.stops, 1)
      assert.equal(usb.destroys, 1)
    }
    assert.equal(current.listenerCount('message'), 1)
    current.isConnected = true
    current.emit('connected', { transport: 'usb-cdc' })
    while ((await client.until('link')).state !== 'usb') {}
    assert.equal(bridge.activeTransport, current)
    assert.deepEqual(current.sent.at(-1), { ...state, link: 'wired' })
  })
}

for (const multiple of [false, true]) {
  test(`canceling an external factory drains allocations before ${multiple ? 'Host' : 'single bridge'} restart`, { timeout: 10000 }, async t => {
    const setup = await fixture(t)
    const manifest = setup.manifests[0]
    let entered
    const entering = new Promise(resolve => { entered = resolve })
    let complete
    const pending = new Promise(resolve => { complete = resolve })
    let allocatedCleanup = 0
    let signal
    const loaded = loadBridgeReplacements(setup.selection, { trusted: true })[0]
    const definition = { manifest, async create(context, metadata) {
      signal = context.signal
      context.onCleanup(() => { allocatedCleanup++ })
      entered()
      await pending
      return loaded.create(context, metadata)
    } }
    const placeholder = transportPlaceholder(definition)
    const options = { replacementPlugins: [definition], socketPath: path.join(setup.directory, 'bridge.sock'), logger: { error() {} } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [placeholder] }) : new RemoteBridge({ ...options, adapter: placeholder })
    t.after(async () => { complete(); await bridge.stop() })
    const starting = bridge.start()
    await entering
    let stopped = false
    const stopping = bridge.stop().then(() => { stopped = true })
    assert.equal(signal.aborted, true)
    await new Promise(setImmediate)
    assert.equal(stopped, false)
    complete()
    await Promise.all([starting, stopping])
    const first = require(setup.entry).created[0]
    assert.equal(first.starts, 0)
    assert.equal(first.stops, 1)
    assert.equal(first.destroys, 1)
    assert.equal(first.listenerCount('message'), 0)
    assert.equal(allocatedCleanup, 1)
    await assert.rejects(fs.stat(options.socketPath), { code: 'ENOENT' })
    await bridge.start()
    const current = multiple ? bridge.transports[0] : bridge.adapter
    assert.notEqual(current, first)
    assert.equal(current.starts, 1)
    assert.equal(current.listenerCount('message'), 1)
  })
}

test('operational entry loads both external transports and keeps USB priority', { timeout: 10000 }, async t => {
  const setup = await fixture(t)
  const cleanup = path.join(setup.directory, 'cleanup.jsonl')
  const statePath = path.join(setup.directory, 'state.json')
  const source = await fs.readFile(setup.entry, 'utf8')
  await fs.writeFile(setup.entry, source
    .replace('item.starts++', "item.starts++; item.isConnected = true; item.emit('connected', { transport: item.transport }); process.stdout.write(manifest.id + '\\n')")
    .replace('item.stops++', `item.stops++; require('node:fs').appendFileSync(${JSON.stringify(cleanup)}, JSON.stringify({ id: manifest.id, phase: 'stop' }) + '\\n')`)
    .replace('item.destroys++', `item.destroys++; require('node:fs').appendFileSync(${JSON.stringify(cleanup)}, JSON.stringify({ id: manifest.id, phase: 'destroy' }) + '\\n')`)
    .replace('item.sent.push(record)', `item.sent.push(record); require('node:fs').writeFileSync(${JSON.stringify(statePath)}, JSON.stringify({ id: manifest.id, record }))`))
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', path.resolve(__dirname, '../lib/main.js'),
    '--plugin-selection', setup.selection, '--trust-plugins'], { env: { ...process.env, XDG_RUNTIME_DIR: setup.directory,
      ODK_CONFIG_DIR: setup.directory, ODK_DISABLED_PLUGINS: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exit = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exit
  })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk
      if (setup.manifests.every(manifest => output.includes(manifest.id + '\n'))) resolve()
    })
    child.once('error', reject)
    child.once('exit', code => reject(Error(`startup exited ${code}: ${errors}`)))
  })
  const client = await clientAt(path.join(setup.directory, 'odk-remote', 'bridge.sock'))
  t.after(() => client.socket.destroy())
  assert.equal((await client.next()).state, 'syncing')
  const state = { v: 1, type: 'state', name: 'Home', page: 1, pages: 1, canPrev: false, canNext: false }
  client.socket.write(JSON.stringify(state) + '\n')
  assert.equal((await client.until('link')).state, 'usb')
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), { id: setup.manifests[0].id, record: { ...state, link: 'wired' } })
  client.socket.write(JSON.stringify({ v: 1, type: 'runtime_diagnose', requestId: '12345678-1234-1234-1234-123456789abc' }) + '\n')
  const report = await client.until('runtime_diagnosis')
  for (const manifest of setup.manifests) {
    const plugin = report.runtime.plugins.find(item => item.manifest.id === manifest.id)
    assert.equal(plugin.state, 'running')
    assert.equal(plugin.manifest.version, '2.0.0')
  }
  client.socket.destroy()
  child.kill('SIGTERM')
  assert.deepEqual(await exit, [0, null], errors)
  await assert.rejects(fs.stat(path.join(setup.directory, 'odk-remote', 'bridge.sock')), { code: 'ENOENT' })
  const records = (await fs.readFile(cleanup, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(records, [setup.manifests[1].id, setup.manifests[0].id].flatMap(id => [{ id, phase: 'stop' }, { id, phase: 'destroy' }]))
})
