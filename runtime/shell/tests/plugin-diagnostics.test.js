const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createPluginHost } = require('../src/plugin-host')
const { createDiagnosticsPlugin: defaultDiagnosticsPlugin, requestDiagnostics } = require('../src/plugin-diagnostics')

for (const selected of [false, true]) {
  function createDiagnosticsPlugin(options = {}) {
    if (!selected) return defaultDiagnosticsPlugin(options)
    const { createMainPlugins } = require('../src/plugins/main-composition')
    const replacement = require('./fixtures/main-diagnostics-replacement').independentMainDiagnostics(options)
    const plugins = createMainPlugins({ replacementPlugins: [replacement], onDefaults(defaults) {
      defaults.find(plugin => plugin.manifest.id === replacement.manifest.id).create = () => { throw Error('Default Main diagnosis refused') }
    } })
    const plugin = plugins.find(plugin => plugin.manifest.id === replacement.manifest.id)
    assert.equal(plugin, replacement)
    assert.equal(plugin.manifest.version, '2.0.0')
    return plugin
  }

  test(`${selected ? 'selected' : 'default'} diagnostics reads active states, refuses unknown identities and releases listener`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-diagnose-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'channel', 'diagnose.sock')
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': {
      endpoint, stateDir: path.join(root, 'state'), platform: process.platform, snapshot: () => host.list(),
    } } })
    host.register(createDiagnosticsPlugin())
    await host.start()
    t.after(() => host.stop())
    const response = await requestDiagnostics({ endpoint, platform: process.platform })
    assert.equal(response.plugins[0].state, 'running')
    assert.equal(response.plugins[0].manifest.id, 'odk.system.plugin-diagnostics')
    await assert.rejects(requestDiagnostics({ endpoint, platform: process.platform, pluginId: 'odk.unknown' }), /unknown-plugin/)
    await host.stop()
    await assert.rejects(requestDiagnostics({ endpoint, platform: process.platform }))
  })

  const { execFile } = require('node:child_process')
  const { promisify } = require('node:util')
  const run = promisify(execFile)
  const { resolveShellHost } = require('../src/platform')

  test(`${selected ? 'selected' : 'default'} CLI diagnoses the real local host and exits unsuccessfully for an active fault`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-diagnose-cli-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config') }
    const shell = resolveShellHost({ env })
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': {
      endpoint: shell.endpoint('plugin-diagnostics'), stateDir: shell.stateDir, platform: shell.platform, snapshot: () => host.list(),
    } } })
    host.register(createDiagnosticsPlugin())
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.failure', name: 'Failure fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [], requires: [], permissions: [] }, create() { throw Error('fixture failure') } })
    await host.start()
    t.after(() => host.stop())
    const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
    const success = await run(process.execPath, [cli, 'diagnose', 'odk.system.plugin-diagnostics'], { env })
    assert.equal(JSON.parse(success.stdout).plugins[0].state, 'running')
    await assert.rejects(run(process.execPath, [cli, 'diagnose'], { env }), error => {
      assert.equal(error.code, 1)
      assert.equal(JSON.parse(error.stdout).plugins.find(plugin => plugin.manifest.id === 'odk.test.failure').state, 'failed')
      return true
    })
    await host.stop()
    await assert.rejects(run(process.execPath, [cli, 'diagnose'], { env }), /Plugin diagnosis unavailable/)
  })

  test(`${selected ? 'selected' : 'default'} a diagnosis plugin without an endpoint cannot claim a running channel`, async () => {
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { snapshot: () => host.list() } } })
    host.register(createDiagnosticsPlugin())
    await host.start()
    assert.equal(host.list()[0].state, 'failed')
    await host.stop()
  })

  test(`${selected ? 'selected' : 'default'} token-gated diagnosis rejects an incorrect token and accepts the shared token`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-diagnose-token-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'diagnose.sock')
    const stateDir = path.join(root, 'state')
    // A local Unix fixture exercises token authentication; it is not Windows pipe acceptance.
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': {
      endpoint, stateDir, platform: 'win32', snapshot: () => host.list(),
    } } })
    host.register(createDiagnosticsPlugin())
    await host.start()
    t.after(() => host.stop())
    assert.equal(host.list()[0].state, 'running')
    const tokenFile = path.join(stateDir, 'local-channel.token')
    assert.equal((await requestDiagnostics({ endpoint, tokenFile, platform: 'win32' })).plugins[0].state, 'running')
    const wrong = path.join(root, 'wrong-token')
    fs.writeFileSync(wrong, 'wrong')
    await assert.rejects(requestDiagnostics({ endpoint, tokenFile: wrong, platform: 'win32' }), /closed/)
  })

  test(`${selected ? 'selected' : 'default'} the diagnosis listener refuses a state-changing request`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-diagnose-readonly-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'channel', 'diagnose.sock')
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, platform: process.platform, snapshot: () => host.list() } } })
    host.register(createDiagnosticsPlugin())
    await host.start()
    t.after(() => host.stop())
    const result = await new Promise((resolve, reject) => {
      const socket = require('node:net').createConnection(endpoint)
      socket.setEncoding('utf8')
      socket.setTimeout(1000, () => { socket.destroy(); reject(Error('fixture response timeout')) })
      socket.on('error', reject)
      let response = ''
      socket.on('connect', () => socket.write(JSON.stringify({ v: 1, id: 'fixture', command: 'disable', pluginId: 'odk.system.plugin-diagnostics' }) + '\n'))
      socket.on('data', chunk => { response += chunk })
      socket.on('end', () => resolve(JSON.parse(response)))
    })
    assert.equal(result.error, 'invalid-command')
    assert.equal(host.list()[0].state, 'running')
  })

  test(`${selected ? 'selected' : 'default'} diagnosis closes an idle partial first frame before protocol acceptance`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-diagnose-idle-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'channel', 'diagnose.sock')
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, platform: process.platform, snapshot: () => host.list() } } })
    host.register(createDiagnosticsPlugin())
    await host.start()
    t.after(() => host.stop())
    await new Promise((resolve, reject) => {
      const socket = require('node:net').createConnection(endpoint)
      const watchdog = setTimeout(() => { socket.destroy(); reject(Error('partial frame survived the diagnosis deadline')) }, 3000)
      socket.on('error', error => { clearTimeout(watchdog); reject(error) })
      socket.on('connect', () => socket.write('{'))
      socket.on('close', () => { clearTimeout(watchdog); resolve() })
    })
    assert.equal(host.list()[0].state, 'running')
  })

  test(`${selected ? 'selected' : 'default'} diagnosis reads declared source health without refresh and withdraws disabled probes`, async t => {
    const { createDataSourcePlugins } = require('../src/plugins/data-sources')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-health-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const env = { ...process.env, XDG_RUNTIME_DIR: root, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config') }
    const endpoint = resolveShellHost({ env }).endpoint('plugin-diagnostics')
    const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
    const id = 'odk.source.weather'
    const port = `odk:plugin-health/${id}/v1`
    let snapshot = { status: 'unavailable', updatedAt: 1000, current: { temperature: 99 }, error: 'private fixture details' }
    let refreshed = 0
    const host = createPluginHost({ capabilities: {
      'plugin.diagnostics': { endpoint, snapshot: () => host.list() },
      'source.weather': { create: () => ({ snapshot: () => snapshot, refresh: async () => { refreshed++; throw Error('must not refresh') } }) },
      ipc: { handle() {}, removeHandler() {} },
    } })
    host.register(createDataSourcePlugins().find(plugin => plugin.manifest.id === id))
    host.register(createDiagnosticsPlugin({ healthPorts: [port] }))
    await host.start()
    t.after(() => host.stop())
    const diagnose = () => requestDiagnostics({ endpoint, pluginId: id })
    let result = (await diagnose()).plugins[0]
    assert.equal(result.state, 'running')
    assert.equal(result.health.state, 'failed')
    assert.equal(result.health.updatedAt, 1000)
    assert.equal(JSON.stringify(result).includes('private fixture details'), false)
    assert.equal(JSON.stringify(result).includes('temperature'), false)
    snapshot = { status: 'stale', updatedAt: 1000 }
    assert.equal((await diagnose()).plugins[0].health.state, 'degraded')
    await assert.rejects(run(process.execPath, [cli, 'diagnose', id], { env }), error => {
      assert.equal(error.code, 1)
      assert.equal(JSON.parse(error.stdout).plugins[0].health.state, 'degraded')
      return true
    })
    snapshot = { status: 'live', updatedAt: 2000 }
    assert.equal((await diagnose()).plugins[0].health.state, 'healthy')
    assert.equal(JSON.parse((await run(process.execPath, [cli, 'diagnose', id], { env })).stdout).plugins[0].health.state, 'healthy')
    snapshot = { status: 'future-state' }
    assert.equal((await diagnose()).plugins[0].health.state, 'unknown')
    await host.setEnabled(id, false)
    result = (await diagnose()).plugins[0]
    assert.equal(result.state, 'disabled')
    assert.equal(result.health.state, 'unknown')
    assert.equal(refreshed, 0)
  })

  test(`${selected ? 'selected' : 'default'} a faulty health probe is bounded to its plugin and cannot expose arbitrary fields`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-health-fault-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'diagnose.sock')
    const ids = ['fault', 'valid', 'invalid', 'async']
    const ports = ids.map(id => `odk:plugin-health/odk.test.${id}/v1`)
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, snapshot: () => host.list() } } })
    for (const [index, id] of ids.entries()) host.register({ manifest: { schemaVersion: 1, id: `odk.test.${id}`, name: id, version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: ports[index] }] }, create() {
      return { ports: { [ports[index]]: { snapshot() {
        if (id === 'fault') throw Error('private fixture details')
        if (id === 'invalid') return { state: 'invented' }
        if (id === 'async') return Promise.reject(Error('private fixture details'))
        return { state: 'healthy', token: 'private fixture details', updatedAt: 1234 }
      } } } }
    } })
    host.register(createDiagnosticsPlugin({ healthPorts: ports }))
    await host.start()
    t.after(() => host.stop())
    const result = await requestDiagnostics({ endpoint })
    assert.equal(result.plugins.find(plugin => plugin.manifest.id === 'odk.test.fault').health.state, 'failed')
    assert.equal(result.plugins.find(plugin => plugin.manifest.id === 'odk.test.invalid').health.state, 'failed')
    assert.equal(result.plugins.find(plugin => plugin.manifest.id === 'odk.test.async').health.state, 'failed')
    assert.equal(result.plugins.find(plugin => plugin.manifest.id === 'odk.test.valid').health.state, 'healthy')
    assert.equal(JSON.stringify(result).includes('private fixture details'), false)
  })

  test(`${selected ? 'selected' : 'default'} a plugin cannot attribute its health snapshot to another plugin identity`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-health-owner-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'diagnose.sock')
    const port = 'odk:plugin-health/odk.test.target/v1'
    let called = 0
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, snapshot: () => host.list() } } })
    const manifest = id => ({ schemaVersion: 1, id, name: id, version: '1.0.0', kind: 'service', host: 'electron-main' })
    host.register({ manifest: { ...manifest('odk.test.owner'), provides: [{ interface: port }] }, create: () => ({ ports: { [port]: { snapshot() { called++; return { state: 'healthy' } } } } }) })
    host.register({ manifest: manifest('odk.test.target'), create: () => ({}) })
    host.register(createDiagnosticsPlugin({ healthPorts: [port] }))
    await host.start()
    t.after(() => host.stop())
    const result = await requestDiagnostics({ endpoint, pluginId: 'odk.test.target' })
    assert.deepEqual(result.plugins[0].health, { state: 'unknown', reason: 'not-declared' })
    assert.equal(called, 0)
  })

  test(`${selected ? 'selected' : 'default'} component health rejects invalid nesting, duplicate identities and false healthy aggregates`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-health-components-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const env = { ...process.env, XDG_RUNTIME_DIR: root, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config') }
    const endpoint = resolveShellHost({ env }).endpoint('plugin-diagnostics')
    const port = 'odk:plugin-health/odk.test.components/v1'
    let value = { state: 'degraded', components: [{ id: 'one', state: 'failed', reason: 'unavailable', updatedAt: 1000, holdings: 'private-fixture' }] }
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, snapshot: () => host.list() } } })
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.components', name: 'Components', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }] }, create: () => ({ ports: { [port]: { snapshot: () => typeof value === 'function' ? value() : value } } }) })
    host.register(createDiagnosticsPlugin({ healthPorts: [port] }))
    await host.start()
    t.after(() => host.stop())
    const diagnose = async () => (await requestDiagnostics({ endpoint, pluginId: 'odk.test.components' })).plugins[0].health
    assert.deepEqual(await diagnose(), { state: 'degraded', components: [{ id: 'one', state: 'failed', reason: 'unavailable', updatedAt: 1000 }] })
    const invalid = [
      { state: 'healthy', components: [{ id: 'one', state: 'failed' }] },
      { state: 'degraded', components: [{ id: 'one', state: 'unknown', components: [] }] },
      { state: 'degraded', components: [{ id: 'one', state: 'failed' }, { id: 'one', state: 'failed' }] },
      { state: 'degraded', components: [{ id: '../unsafe', state: 'failed' }] },
      { state: 'degraded', components: Array.from({ length: 65 }, (_, id) => ({ id: `service-${id}`, state: 'failed' })) },
      { state: 'degraded', components: [{ id: 'one', state: 'invented' }] },
      () => ({ state: 'degraded', components: Promise.reject(Error('private-fixture')) }),
      () => ({ state: 'degraded', components: [Promise.reject(Error('private-fixture')), Promise.reject(Error('private-fixture'))] }),
      () => ({ state: 'invented', components: Promise.reject(Error('private-fixture')) }),
      () => ({ state: 'degraded', components: [...Array.from({ length: 64 }, (_, id) => ({ id: `service-${id}`, state: 'failed' })), Promise.reject(Error('private-fixture'))] }),
      () => ({ state: 'degraded', components: [{ id: 'one', state: 'invented', components: [Promise.reject(Error('private-fixture'))] }] }),
    ]
    for (const snapshot of invalid) {
      value = snapshot
      assert.deepEqual(await diagnose(), { state: 'failed', reason: 'invalid-health-snapshot' })
    }
    value = { state: 'unknown', components: [{ id: 'one', state: 'failed' }] }
    const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
    await assert.rejects(run(process.execPath, [cli, 'diagnose', 'odk.test.components'], { env }), error => {
      assert.equal(error.code, 1)
      assert.equal(JSON.parse(error.stdout).plugins[0].health.components[0].state, 'failed')
      return true
    })
  })

  test(`${selected ? 'selected' : 'default'} runtime diagnosis rejects missing or nonstring unavailable reasons`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-rreason-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'diag.sock')
    const port = 'odk:plugin-runtime/electron-renderer/v1'
    let reason
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': {
      endpoint, stateDir: path.join(root, 'state'), platform: process.platform, snapshot: () => host.list(),
    } } })
    t.after(() => host.stop())
    host.register(createDiagnosticsPlugin({ runtimePorts: [port] }))
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.runtime', name: 'Runtime fixture', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: port }] },
      create: () => ({ ports: { [port]: { snapshot: () => [{ host: 'electron-renderer', instance: 'test', state: 'unavailable', reason, plugins: [] }] } } }) })
    await host.start()
    for (const invalid of [undefined, null, true, false, 123]) {
      reason = invalid
      const response = await requestDiagnostics({ endpoint, platform: process.platform })
      assert.equal(response.runtimes[0].reason, 'probe-failed')
    }
    reason = 'timeout'
    const response = await requestDiagnostics({ endpoint, platform: process.platform })
    assert.equal(response.runtimes[0].reason, 'timeout')
    await host.stop()
  })

  test(`${selected ? 'selected' : 'default'} named runtime ports keep resident and Hosted Pi identities distinct`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-named-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'diag.sock')
    const residentPort = 'odk:plugin-runtime/personal-agent/v1'
    const hostedPort = 'odk:plugin-runtime/personal-agent/hosted-pi/v1'
    let hostedInstance = 'hosted-pi'
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, stateDir: root, snapshot: () => host.list() } } })
    t.after(() => host.stop())
    host.register(createDiagnosticsPlugin({ runtimePorts: [residentPort, hostedPort] }))
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.instances', name: 'Instances', version: '1.0.0', kind: 'system', host: 'electron-main', provides: [residentPort, hostedPort].map(interfaceName => ({ interface: interfaceName })) },
      create: () => ({ ports: {
        [residentPort]: { snapshot: () => [{ host: 'personal-agent', instance: 'resident', state: 'unavailable', reason: 'disconnected', plugins: [] }] },
        [hostedPort]: { snapshot: () => [{ host: 'personal-agent', instance: hostedInstance, state: 'unavailable', reason: 'disconnected', plugins: [] }] },
      } }) })
    await host.start()
    let result = await requestDiagnostics({ endpoint })
    assert.deepEqual(result.runtimes.map(runtime => [runtime.host, runtime.instance]), [['personal-agent', 'resident'], ['personal-agent', 'hosted-pi']])
    hostedInstance = 'resident'
    result = await requestDiagnostics({ endpoint })
    assert.equal(result.runtimes[1].instance, 'hosted-pi')
    assert.equal(result.runtimes[1].reason, 'probe-failed')
  })

  test(`${selected ? 'selected' : 'default'} Main diagnosis preserves valid runtime projection and independent providers across restart`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-diag-restart-'))
    const endpoint = path.join(root, 'diag.sock')
    const port = 'odk:plugin-runtime/electron-renderer/v1'
    const manifest = { schemaVersion: 1, id: 'odk.tile.clock', name: 'Clock', version: '2.0.0', kind: 'surface',
      host: 'electron-renderer', provides: [], requires: [], permissions: [] }
    let runtime = { host: 'electron-renderer', instance: 'frame-1', state: 'available', privateError: 'private-fixture',
      plugins: [{ manifest: { ...manifest, privateField: 'private-fixture' }, state: 'running', enabled: true, privateError: 'private-fixture' }] }
    const provider = { snapshot: () => [runtime] }
    const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, snapshot: () => host.list() } } })
    t.after(async () => { await host.stop(); fs.rmSync(root, { recursive: true, force: true }) })
    host.register(createDiagnosticsPlugin({ runtimePorts: [port] }))
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.runtime', name: 'Runtime', version: '1.0.0', kind: 'system',
      host: 'electron-main', provides: [{ interface: port }] }, create: () => ({ ports: { [port]: provider } }) })
    await host.start()
    const diagnose = pluginId => requestDiagnostics({ endpoint, pluginId })
    const report = await diagnose('odk.tile.clock')
    assert.deepEqual(report.plugins, [])
    assert.deepEqual(report.runtimes, [{ host: 'electron-renderer', instance: 'frame-1', state: 'available', plugins: [{
      manifest, state: 'running', enabled: true, health: { state: 'unknown', reason: 'not-declared' },
    }] }])
    assert.equal(JSON.stringify(report).includes('private-fixture'), false)
    await assert.rejects(require('../src/local-control-client').requestLocalControl({ endpoint,
      request: { command: 'diagnose', pluginId: {} } }), /unknown-plugin/)
    await host.setEnabled('odk.system.plugin-diagnostics', false)
    assert.equal(host.get(port), provider)
    assert.equal(fs.existsSync(endpoint), false)
    await assert.rejects(diagnose('odk.tile.clock'))
    await host.setEnabled('odk.system.plugin-diagnostics', true)
    assert.equal(host.get(port), provider)
    assert.deepEqual((await diagnose('odk.tile.clock')).runtimes, report.runtimes)
    runtime = { ...runtime, plugins: [{ ...runtime.plugins[0], manifest: { ...manifest, host: 'electron-main' } }] }
    assert.equal((await diagnose()).runtimes[0].reason, 'probe-failed')
    await assert.rejects(diagnose('odk.tile.clock'), /runtime-unavailable/)
    await host.stop()
    assert.equal(fs.existsSync(endpoint), false)
  })
}
