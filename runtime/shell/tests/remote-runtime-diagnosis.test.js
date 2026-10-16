'use strict'
const { integrationPath } = require('./helpers/repo-root')

const test = require('node:test')
if (require('./not-ported').notPortedOnWindows(test, 'unix-socket')) return
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
const { createPluginHost } = require('../src/plugin-host')
const { SYSTEM_PORTS } = require('../src/plugins/system-channels')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { independentRemoteDiagnosis } = require('./fixtures/channel-diagnostic-replacements')

function selectedProvider(independent) {
  const provider = createMainPlugins({ replacementPlugins: independent ? [independentRemoteDiagnosis()] : [] })
    .find(plugin => plugin.manifest.id === 'odk.system.remote-bridge-diagnostics')
  assert.equal(provider.manifest.version, independent ? '2.0.0' : '1.0.0')
  return provider
}

class Transport extends EventEmitter {
  constructor() { super(); this.manifest = { id: 'odk.remote.transport.fixture' }; this.sent = [] }
  async init() {}
  async start() {}
  async stop() {}
  async destroy() {}
  async send(value) { this.sent.push(value) }
}

for (const independent of [false, true]) for (const multiple of [false, true]) test(`${independent ? 'selected independent' : 'default'} diagnosis reads the actual ${multiple ? 'multiple transport' : 'single adapter'} bridge catalog`, { timeout: 3000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-rdiag-'))
  const socketPath = path.join(directory, 'bridge.sock')
  const transport = new Transport()
  const { RemoteBridge } = require(integrationPath('remote-bridge/lib/remote-bridge'))
  const { RemoteBridgeHost } = require(integrationPath('remote-bridge/lib/remote-bridge-host'))
  const bridge = multiple ? new RemoteBridgeHost({ socketPath, transports: [transport], logger: { error() {} } })
    : new RemoteBridge({ socketPath, adapter: transport, logger: { error() {} } })
  t.after(async () => { await bridge.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  await bridge.start()
  const client = createRemoteBridgeClient({ socketPath })
  t.after(() => client.stop())
  client.start()
  const host = createPluginHost()
  const provider = selectedProvider(independent)
  assert.ok(provider)
  host.register(provider)
  host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.remote', name: 'Remote', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: SYSTEM_PORTS.remoteLink }] },
    create: () => ({ ports: { [SYSTEM_PORTS.remoteLink]: { client } } }) })
  t.after(() => host.stop())
  await host.start()
  const port = host.get('odk:plugin-runtime/remote-bridge/v1')
  const result = await port.snapshot()
  assert.equal(result[0].state, 'available')
  assert.deepEqual(result[0].plugins.map(plugin => plugin.manifest.id).sort(), ['odk.remote.control', 'odk.remote.listener', transport.manifest.id].sort())
  assert.ok(result[0].plugins.every(plugin => plugin.state === 'running'))
  assert.equal(bridge.latestShellState, null)
  assert.deepEqual(transport.sent, [])
  await bridge.setTransportEnabled(transport.manifest.id, false)
  assert.equal((await port.snapshot())[0].plugins.find(plugin => plugin.manifest.id === transport.manifest.id).state, 'disabled')
  await host.stop()
  assert.equal((await port.snapshot())[0].reason, 'stopped')
  assert.equal((await client.diagnose())[0].state, 'available')
})

for (const independent of [false, true]) test(`${independent ? 'selected independent' : 'default'} bridge diagnosis preserves optional and legacy clients`, async t => {
  for (const client of [undefined, {}]) await t.test(client ? 'legacy client' : 'absent client', async t => {
    const host = createPluginHost()
    t.after(() => host.stop())
    host.register(selectedProvider(independent))
    if (client) host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.remote', name: 'Remote', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: SYSTEM_PORTS.remoteLink }] },
      create: () => ({ ports: { [SYSTEM_PORTS.remoteLink]: { client } } }) })
    await host.start()
    const port = host.get('odk:plugin-runtime/remote-bridge/v1')
    assert.deepEqual(await port.snapshot(), [{ host: 'remote-bridge', instance: 'bridge', state: 'unavailable', reason: client ? 'not-supported' : 'provider-unavailable', plugins: [] }])
    await host.stop()
    assert.equal((await port.snapshot())[0].reason, 'stopped')
  })
})

test('older bridges retain the input connection while diagnosis times out or stops', { timeout: 3000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-rold-'))
  const socketPath = path.join(directory, 'bridge.sock')
  const peers = new Set()
  const server = net.createServer(peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer))
    peer.write('{"v":1,"type":"link","state":"usb"}\n')
  })
  server.listen(socketPath)
  await once(server, 'listening')
  const client = createRemoteBridgeClient({ socketPath, diagnosisTimeoutMs: 20 })
  t.after(async () => { client.stop(); for (const peer of peers) peer.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
  const linked = new Promise(resolve => client.onLinkState(state => { if (state === 'usb') resolve() }))
  client.start()
  await linked
  assert.equal((await client.diagnose())[0].reason, 'timeout')
  assert.equal(client.getLinkState(), 'usb')
  const controller = new AbortController()
  const request = client.diagnose({ signal: controller.signal })
  controller.abort()
  assert.equal((await request)[0].reason, 'stopped')
  const pending = Array.from({ length: 16 }, () => client.diagnose())
  assert.equal((await client.diagnose())[0].reason, 'busy')
  client.stop()
  assert.ok((await Promise.all(pending)).every(result => result[0].reason === 'stopped'))
})

for (const independent of [false, true]) test(`${independent ? 'selected independent' : 'default'} bridge diagnosis reports failed transports through the CLI without exposing errors`, { timeout: 3000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-rfail-'))
  const socketPath = path.join(directory, 'bridge.sock')
  const transport = new Transport()
  transport.start = async () => { throw Error('private transport details') }
  const { RemoteBridgeHost } = require(integrationPath('remote-bridge/lib/remote-bridge-host'))
  const bridge = new RemoteBridgeHost({ socketPath, transports: [transport], logger: { error() {} } })
  const client = createRemoteBridgeClient({ socketPath })
  const host = createPluginHost({ capabilities: { 'plugin.diagnostics': {
    endpoint: path.join(directory, 'odk-plugins', 'diagnose.sock'), stateDir: directory, snapshot: () => host.list(),
  } } })
  t.after(async () => { await host.stop(); client.stop(); await bridge.stop(); await fs.rm(directory, { recursive: true, force: true }) })
  await bridge.start()
  client.start()
  host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.remote', name: 'Remote', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: SYSTEM_PORTS.remoteLink }] },
    create: () => ({ ports: { [SYSTEM_PORTS.remoteLink]: { client } } }) })
  host.register(selectedProvider(independent))
  host.register(require('../src/plugin-diagnostics').createDiagnosticsPlugin({ runtimePorts: ['odk:plugin-runtime/remote-bridge/v1'] }))
  await host.start()
  const execFile = require('node:util').promisify(require('node:child_process').execFile)
  await assert.rejects(execFile(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'diagnose', transport.manifest.id], {
    env: { ...process.env, XDG_RUNTIME_DIR: directory, XDG_STATE_HOME: directory, ODK_CONFIG_DIR: path.join(directory, 'config') },
  }), error => {
    assert.equal(error.code, 1)
    assert.equal(JSON.parse(error.stdout).runtimes[0].plugins[0].state, 'failed')
    assert.equal(error.stdout.includes('private'), false)
    return true
  })
})

test('bridge probes match request identity and reject invalid or oversized reports', { timeout: 3000 }, async t => {
  const { createRuntimeChannelProbe } = require('../src/runtime-channel-probe')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-rbounds-'))
  const endpoint = path.join(directory, 'a.sock')
  let mode = 'identity'
  const peers = new Set()
  const server = net.createServer(peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer))
    peer.once('data', chunk => {
      const request = JSON.parse(chunk.toString())
      if (mode === 'oversized') { peer.write('x'.repeat(65537)); return }
      const reply = { v: 1, type: 'runtime_diagnosis', requestId: request.requestId,
        runtime: { host: 'remote-bridge', instance: 'bridge', state: 'unavailable', reason: mode === 'invalid' ? null : 'not-supported', plugins: [] } }
      peer.write(`${JSON.stringify({ ...reply, requestId: 'wrong-request' })}\n${JSON.stringify(reply)}\n`)
    })
  })
  server.listen(endpoint)
  await once(server, 'listening')
  const probe = createRuntimeChannelProbe({ endpoint, host: 'remote-bridge', instance: 'bridge', connect: net.createConnection })
  t.after(async () => { probe.stop(); for (const peer of peers) peer.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
  assert.equal((await probe.request())[0].reason, 'not-supported')
  mode = 'invalid'
  assert.equal((await probe.request())[0].reason, 'invalid-report')
  mode = 'oversized'
  assert.equal((await probe.request())[0].reason, 'invalid-report')
})
