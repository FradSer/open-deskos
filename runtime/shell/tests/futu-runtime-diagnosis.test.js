'use strict'
const { integrationPath } = require('./helpers/repo-root')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { serviceChannel, diagnosticChannel, pythonExecutable } = require('./helpers/private-test-host.cjs')
const port = 'odk:plugin-runtime/python-agent/futu-poller/v1'

test('Main exposes the owned Futu source report through a declared runtime port', async t => {
  const plugin = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.system.futu-runtime-diagnostics')
  assert.ok(plugin)
  const host = createPluginHost()
  t.after(() => host.stop())
  let queries = 0
  host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.futu', name: 'Fixture', version: '1.0.0', host: 'electron-main', kind: 'service', permissions: [], requires: [], provides: [{ interface: DESK_PORTS.futu }] },
    create: () => ({ ports: { [DESK_PORTS.futu]: { source: { async diagnoseRuntime(service, options) {
      assert.equal(service, 'futu-poller')
      assert.ok(options.signal instanceof AbortSignal)
      queries++
      return { host: 'python-agent', instance: 'futu-poller', state: 'unavailable', reason: 'timeout', plugins: [] }
    } } } } }),
  })
  host.register(plugin)
  await host.start()
  assert.equal((await host.get(port).snapshot())[0].reason, 'timeout')
  assert.equal(queries, 1)
})

test('legacy injected Futu sources report unavailable without changing their interface', async t => {
  const plugin = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.system.futu-runtime-diagnostics')
  assert.ok(plugin)
  const host = createPluginHost()
  t.after(() => host.stop())
  host.register(plugin)
  await host.start()
  assert.deepEqual(await host.get(port).snapshot(), [{ host: 'python-agent', instance: 'futu-poller', state: 'unavailable', reason: 'provider-unavailable', plugins: [] }])
})

for (const independent of [false, true]) test(`${independent ? 'selected independent' : 'default'} Main diagnosis reaches the actual Python publisher through its owned Futu source`, async t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { spawn } = require('node:child_process')
  const { once } = require('node:events')
  const { createFutuSource } = require('../src/futu-source')
  const { requestDiagnostics } = require('../src/plugin-diagnostics')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-fmain-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const channel = await serviceChannel(root)
  const diagnostic = diagnosticChannel(root)
  const endpoint = channel.endpoint
  const env = diagnostic.env
  const diagnosisEndpoint = diagnostic.endpoint
  const host = createPluginHost({ capabilities: {
    ipc: { handle() {}, removeHandler() {} },
    'desk.catalog': { create: () => ({ list: async () => [] }) },
    'desk.futu': { create: createFutuSource, options: { channelToken: channel.channelToken, stateDir: channel.stateDir }, env: { ODK_FUTU_ENDPOINT: endpoint }, report() {} },
    'plugin.diagnostics': { ...diagnostic, endpoint: diagnosisEndpoint, snapshot: () => host.list() },
  } })
  t.after(() => host.stop())
  const replacements = independent ? [require('./fixtures/futu-diagnostic-replacement').independentFutuDiagnosis()] : []
  const selected = createMainPlugins({ replacementPlugins: replacements })
  assert.equal(selected.find(plugin => plugin.manifest.id === 'odk.system.futu-runtime-diagnostics').manifest.version, independent ? '2.0.0' : '1.0.0')
  selected.filter(plugin => ['odk.system.package-catalog', 'odk.service.futu', 'odk.system.futu-runtime-diagnostics', 'odk.system.plugin-diagnostics'].includes(plugin.manifest.id))
    .forEach(plugin => host.register(plugin))
  await host.start()
  await host.get(DESK_PORTS.futu).refresh()
  const code = [
    'import poller, sys',
    'runtime = poller.create_poller({"ODK_FUTU_SOCKET": sys.argv[1], "ODK_CHANNEL_TOKEN_FILE": sys.argv[2], "ODK_FUTU_CONTROL": ""})',
    'runtime.start()',
    'publisher = runtime.host.get(poller.PORTS["publisher"])',
    'try:',
    ' publisher.send({"type":"data","snapshot":{"positions":[]}})',
    ' print("waiting", flush=True)',
    ' publisher.wait(2)',
    'finally: runtime.close()',
  ].join('\n')
  const child = spawn(pythonExecutable, ['-c', code, endpoint, channel.tokenFile], { cwd: integrationPath('futu-poller') })
  t.after(() => { if (child.exitCode === null) child.kill() })
  const completed = once(child, 'exit')
  let stderr = ''
  child.stderr.on('data', bytes => { stderr += bytes })
  const [ready] = await once(child.stdout, 'data')
  assert.equal(ready.toString().trim(), 'waiting')
  const result = await requestDiagnostics({ ...diagnostic, endpoint: diagnosisEndpoint, platform: process.platform, pluginId: 'odk.futu.publisher' })
  const runtime = result.runtimes.find(runtime => runtime.host === 'python-agent')
  assert.equal(runtime.state, 'available')
  assert.equal(runtime.plugins[0].manifest.id, 'odk.futu.publisher')
  assert.equal(runtime.plugins[0].state, 'running')
  assert.equal(host.get(DESK_PORTS.futu).source.snapshot('futu-poller').state, 'live')
  const { execFile } = require('node:child_process')
  const { promisify } = require('node:util')
  const cli = path.join(__dirname, '../scripts/odk-plugin-cli.js')
  const output = await promisify(execFile)(process.execPath, ['--require', path.join(__dirname, 'helpers/private-test-host.cjs'), cli, 'diagnose', 'odk.futu.publisher'], { env })
  assert.equal(JSON.parse(output.stdout).runtimes.find(runtime => runtime.host === 'python-agent').plugins[0].state, 'running')
  assert.equal((await completed)[0], 0, stderr)
})
