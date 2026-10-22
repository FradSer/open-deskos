'use strict'
const { integrationURL } = require('./helpers/repo-root')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { once } = require('node:events')
const { privateEndpoint, diagnosticChannel } = require('./helpers/private-test-host.cjs')
const { createPersonalAgentClient } = require('../src/personal-agent-client')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { independentResidentDiagnosis } = require('./fixtures/channel-diagnostic-replacements')

function selectedProvider(independent) {
  const provider = createMainPlugins({ replacementPlugins: independent ? [independentResidentDiagnosis()] : [] })
    .find(plugin => plugin.manifest.id === 'odk.system.personal-agent-diagnostics')
  assert.equal(provider.manifest.version, independent ? '2.0.0' : '1.0.0')
  return provider
}
const { createDiagnosticsPlugin, requestDiagnostics } = require('../src/plugin-diagnostics')

for (const independent of [false, true]) test(`${independent ? 'selected independent' : 'default'} resident diagnosis reaches the actual composition through the authenticated Shell channel`, { timeout: 5000 }, async t => {
  const { listen } = await import(integrationURL('personal-agent/src/socket.mjs'))
  const { createPersonalAgentComposition } = await import(integrationURL('personal-agent/src/plugin-composition.mjs'))
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-bdiag-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const endpoint = privateEndpoint(directory, 'resident')
  const channel = diagnosticChannel(directory)
  const token = 'a'.repeat(64)
  let toggles = 0
  let snapshots = 0
  const service = { status: { v: 1, type: 'status', state: 'error', message: 'private voice reply' },
    subscribe: () => () => {}, close() {}, toggle() { toggles++; return Promise.resolve() } }
  const composition = createPersonalAgentComposition({ createService: () => service,
    openChannel: value => listen(endpoint, value, { token, runtimeSnapshot: () => { snapshots++; return composition.catalog() } }),
    initialize() { throw Error('private Agent configuration') }, createHome() { throw Error('must not run') },
  })
  t.after(() => composition.stop())
  await composition.start()
  const bad = require('node:net').connect(endpoint)
  await once(bad, 'connect')
  const refused = once(bad, 'close')
  bad.write(`${JSON.stringify({ v: 1, token: 'b'.repeat(64) })}\n${JSON.stringify({ v: 1, type: 'runtime_diagnose', requestId: require('node:crypto').randomUUID() })}\n`)
  await refused
  assert.equal(snapshots, 0)
  const client = createPersonalAgentClient({ token: 'a'.repeat(64), socketPath: endpoint, token })
  t.after(() => client.stop())
  const connected = new Promise(resolve => { client.subscribe(state => { if (state.state === 'error') resolve() }) })
  client.start()
  await connected
  const host = createPluginHost({ capabilities: {
    'plugin.diagnostics': { ...channel, snapshot: () => host.list() },
  } })
  t.after(() => host.stop())
  const provider = selectedProvider(independent)
  assert.ok(provider)
  host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.bot-client', name: 'Client', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: 'odk:system/personal-agent/v1' }] },
    create: () => ({ ports: { 'odk:system/personal-agent/v1': client } }) })
  host.register(provider)
  host.register(createDiagnosticsPlugin({ runtimePorts: ['odk:plugin-runtime/personal-agent/v1'] }))
  await host.start()
  const result = await requestDiagnostics({ ...channel, pluginId: 'odk.personal-agent.runtime' })
  assert.equal(result.runtimes[0].state, 'available')
  assert.equal(result.runtimes[0].plugins[0].state, 'failed')
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(toggles, 0)
  assert.equal(snapshots, 1)
  const execFile = require('node:util').promisify(require('node:child_process').execFile)
  await assert.rejects(execFile(process.execPath, ['--require', path.join(__dirname, 'helpers/private-test-host.cjs'), path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'diagnose', 'odk.personal-agent.runtime'], {
    env: channel.env,
  }), error => {
    assert.equal(error.code, 1)
    const response = JSON.parse(error.stdout)
    assert.equal(response.runtimes[0].plugins[0].state, 'failed')
    assert.equal(error.stdout.includes('private'), false)
    return true
  })
  const port = host.get('odk:plugin-runtime/personal-agent/v1')
  await host.stop()
  assert.equal((await port.snapshot())[0].reason, 'stopped')
  client.stop()
  assert.equal((await client.diagnose())[0].reason, 'disconnected')
})

test('invalid asynchronous resident snapshots remain unavailable without leaking rejected errors', { timeout: 3000 }, async t => {
  const { listen } = await import(integrationURL('personal-agent/src/socket.mjs'))
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-basync-'))
  const endpoint = privateEndpoint(directory, 'resident')
  const service = { status: { v: 1, type: 'status', state: 'idle' }, subscribe: () => () => {} }
  const server = await listen(endpoint, service, { token: 'a'.repeat(64), runtimeSnapshot: () => Promise.reject(Error('private failure')) })
  const client = createPersonalAgentClient({ token: 'a'.repeat(64), socketPath: endpoint })
  t.after(async () => { client.stop(); await server.close(); await fs.rm(directory, { recursive: true, force: true }) })
  const ready = new Promise(resolve => { client.subscribe(state => { if (state.state === 'idle') resolve() }) })
  client.start()
  await ready
  const result = await client.diagnose()
  assert.equal(result[0].reason, 'invalid-report')
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(client.snapshot().state, 'idle')
})

for (const independent of [false, true]) test(`${independent ? 'selected independent' : 'default'} diagnosis requests are bounded and client stop cancels pending work`, { timeout: 3000 }, async t => {
  const net = require('node:net')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-bpend-'))
  const endpoint = privateEndpoint(directory, 'resident')
  const server = net.createServer()
  server.listen(endpoint)
  await once(server, 'listening')
  const client = createPersonalAgentClient({ token: 'a'.repeat(64), socketPath: endpoint, diagnosisTimeoutMs: 20 })
  let peer
  t.after(async () => { client.stop(); peer?.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
  const connection = once(server, 'connection')
  client.start()
  ;[peer] = await connection
  await once(peer, 'data')
  const ready = new Promise(resolve => { client.subscribe(state => { if (state.state === 'idle') resolve() }) })
  peer.write('{"v":1,"type":"status","state":"idle","runtimeDiagnosis":1}\n')
  await ready
  assert.equal((await client.diagnose())[0].reason, 'timeout')
  const provider = selectedProvider(independent)
  const host = createPluginHost()
  host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.client', name: 'Client', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: 'odk:system/personal-agent/v1' }] },
    create: () => ({ ports: { 'odk:system/personal-agent/v1': client } }) })
  host.register(provider)
  await host.start()
  const providerRequest = host.get('odk:plugin-runtime/personal-agent/v1').snapshot()
  await host.setEnabled(provider.manifest.id, false)
  assert.equal((await providerRequest)[0].reason, 'stopped')
  assert.equal(client.toggle(), true)
  await host.stop()
  const pending = Array.from({ length: 16 }, () => client.diagnose())
  assert.equal((await client.diagnose())[0].reason, 'busy')
  client.stop()
  assert.ok((await Promise.all(pending)).every(result => result[0].reason === 'stopped'))
})

test('runtime reports reject invalid reasons and correlate out-of-order replies without changing voice state', { timeout: 3000 }, async t => {
  const net = require('node:net')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-breply-'))
  const endpoint = privateEndpoint(directory, 'resident')
  const server = net.createServer()
  server.listen(endpoint)
  await once(server, 'listening')
  const client = createPersonalAgentClient({ token: 'a'.repeat(64), socketPath: endpoint })
  let peer
  t.after(async () => { client.stop(); peer?.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
  const connection = once(server, 'connection')
  client.start()
  ;[peer] = await connection
  await once(peer, 'data')
  const ready = new Promise(resolve => { client.subscribe(state => { if (state.state === 'idle') resolve() }) })
  peer.write('{"v":1,"type":"status","state":"idle","runtimeDiagnosis":1}\n')
  await ready
  peer.setEncoding('utf8')
  let buffer = ''
  const requests = []
  peer.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n'); buffer = lines.pop()
    for (const line of lines) requests.push(JSON.parse(line))
  })
  const first = client.diagnose()
  const second = client.diagnose()
  while (requests.length < 2) await once(peer, 'data')
  const reply = (requestId, reason) => peer.write(`${JSON.stringify({ v: 1, type: 'runtime_diagnosis', requestId,
    runtime: { host: 'personal-agent', instance: 'resident', state: 'unavailable', reason, plugins: [] } })}\n`)
  reply('wrong-request', 'timeout')
  reply(requests[1].requestId, 'not-supported')
  reply(requests[0].requestId, null)
  assert.equal((await second)[0].reason, 'not-supported')
  assert.equal((await first)[0].reason, 'invalid-report')
  assert.equal(client.snapshot().state, 'idle')
  const disconnected = client.diagnose()
  peer.destroy()
  assert.equal((await disconnected)[0].reason, 'disconnected')
})

test('diagnosing an older resident sends no unknown command and preserves its voice connection', { timeout: 3000 }, async t => {
  const net = require('node:net')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-bolder-'))
  const endpoint = privateEndpoint(directory, 'resident')
  const commands = []
  let peer
  const server = net.createServer(socket => {
    peer = socket
    socket.on('data', chunk => {
      for (const line of chunk.toString().trim().split('\n')) {
        const command = JSON.parse(line)
        if (command.token !== undefined) { assert.equal(command.token, 'a'.repeat(64)); continue }
        commands.push(command.type)
        if (command.type === 'status') socket.write('{"v":1,"type":"status","state":"idle"}\n')
        else if (command.type !== 'toggle') socket.destroy()
      }
    })
  })
  server.listen(endpoint)
  await once(server, 'listening')
  const client = createPersonalAgentClient({ token: 'a'.repeat(64), socketPath: endpoint })
  t.after(async () => { client.stop(); peer?.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
  const ready = new Promise(resolve => { client.subscribe(state => { if (state.state === 'idle') resolve() }) })
  client.start()
  await ready
  assert.equal((await client.diagnose())[0].reason, 'not-supported')
  const received = once(peer, 'data')
  assert.equal(client.toggle(), true)
  await received
  assert.deepEqual(commands, ['status', 'toggle'])
  assert.equal(client.snapshot().state, 'idle')
})

for (const independent of [false, true]) test(`${independent ? 'selected independent' : 'default'} older Personal Agent replacements retain their port contract and explicit diagnosis limits`, async () => {
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.system.personal-agent')
  assert.deepEqual(original.manifest.provides, [{ interface: 'odk:system/personal-agent/v1' }])
  const provider = selectedProvider(independent)
  const host = createPluginHost()
  host.register(provider)
  host.register({ manifest: { ...original.manifest, permissions: [] }, create: () => ({ ports: { 'odk:system/personal-agent/v1': {} } }) })
  await host.start()
  assert.equal((await host.get('odk:plugin-runtime/personal-agent/v1').snapshot())[0].reason, 'not-supported')
  await host.setEnabled('odk.system.personal-agent', false)
  assert.equal((await host.get('odk:plugin-runtime/personal-agent/v1').snapshot())[0].reason, 'provider-unavailable')
  await host.stop()
})
