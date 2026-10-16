'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

async function fixture(t) {
  const channels = new Map()
  const reports = []
  const bridge = name => ({
    onRequest(callback) {
      assert.equal(channels.has(name), false)
      channels.set(name, callback)
      return () => channels.delete(name)
    },
    report(requestId, result) { reports.push({ name, requestId, result }) },
  })
  let pagehide
  let stopped
  const root = {
    odkPluginHost: { createPluginHost(options) {
      const host = createPluginHost(options)
      const stop = host.stop
      host.stop = () => (stopped = stop())
      return host
    } },
    odkPluginDiagnosis: bridge('diagnosis'),
    odkRendererControlBridge: bridge('control'),
    odkPlugins: { catalog: () => [{ manifest: { id: 'odk.tile.clock' }, state: 'running' }] },
    odkTheme: { catalog: () => [] },
    odkRendererRuntime: {},
    addEventListener(name, callback) { assert.equal(name, 'pagehide'); pagehide = callback },
  }
  const context = vm.createContext({ window: root, console })
  for (const name of ['plugin-control.js', 'plugin-diagnostics.js']) {
    vm.runInContext(fs.readFileSync(`src/renderer/core/${name}`, 'utf8'), context)
  }
  await root.odkRendererDiagnosis.ready
  t.after(async () => { pagehide({ persisted: false }); await stopped })
  return { root, channels, reports,
    async request(name, command, options = {}) {
      channels.get(name)({ requestId: 'fixture', command, ...options })
      await new Promise(resolve => setImmediate(resolve))
      return JSON.parse(JSON.stringify(reports.at(-1).result))
    },
    async close() { pagehide({ persisted: false }); await stopped },
  }
}

test('selected control bridge preserves public surface and Appearance management receipts', async t => {
  const traces = []
  for (const selected of [false, true]) {
    const f = await fixture(t)
    const runtime = f.root.odkRendererDiagnosis
    const records = new Map(['odk.tile.clock', 'odk.theme.pixel'].map(id => [id,
      { manifest: { id, version: '1.0.0' }, state: 'running' }]))
    const catalog = id => [records.get(id)]
    const surface = 'odk.tile.clock'
    const appearance = 'odk.theme.pixel'
    const controllers = id => ({
      async setEnabled(pluginId, enabled) { assert.equal(pluginId, id); records.get(id).state = enabled ? 'running' : 'disabled' },
      async restoreDefault(pluginId) {
        assert.equal(pluginId, id)
        records.get(id).manifest.version = '1.0.0'
        records.get(id).state = 'running'
        return { implementation: 'built-in', version: '1.0.0', state: 'running' }
      },
    })
    f.root.odkPlugins = { catalog: () => catalog(surface), hasFailedPlacement: () => false }
    f.root.odkRendererRuntime = { ...controllers(surface), async replace(definition) {
      assert.equal(definition.id, surface); records.get(surface).manifest.version = definition.manifest.version
    } }
    f.root.odkTheme = { ...controllers(appearance), catalog: () => catalog(appearance), async activate(request) {
      records.get(appearance).manifest.version = request.version
    } }
    f.root.odkRendererDevelopment = { async load(request) {
      assert.equal(request.pluginId, surface)
      return [{ id: surface, manifest: { id: surface, version: '2.0.0' } }]
    } }
    if (selected) {
      const manifest = runtime.catalog().find(p => p.manifest.id === 'odk.renderer.plugin-control').manifest
      const { independentControlBridge } = require('./fixtures/renderer-bridge-control-replacement')
      await runtime.replace(independentControlBridge(f.root, { ...manifest, version: '2.0.0' }))
      assert.equal(runtime.catalog().find(p => p.manifest.id === manifest.id).manifest.version, '2.0.0')
    }
    const trace = []
    const selection = { revision: 'a'.repeat(64), version: '2.0.0', entryUrl: `odk-native-plugin://${'b'.repeat(32)}/entry.js` }
    for (const id of [surface, appearance]) {
      for (const command of ['disable', 'enable', 'activate', 'restore-default']) {
        const result = await f.request('control', command, { pluginId: id, ...selection })
        assert.equal(result.ok, true, `${selected ? 'selected' : 'default'} ${command}`)
        assert.equal(result.state, records.get(id).state)
        assert.equal(result.state, command === 'disable' ? 'disabled' : 'running')
        if (command === 'activate' || command === 'restore-default') assert.equal(result.version, records.get(id).manifest.version)
        trace.push(result)
      }
    }
    trace.push(await f.request('control', 'activate', { pluginId: surface, ...selection, entryUrl: 'file:///untrusted.js' }))
    assert.equal(trace.at(-1).error, 'activation-failed')
    f.root.odkRendererRuntime.restoreDefault = async () => { throw Error('private cleanup failure') }
    trace.push(await f.request('control', 'restore-default', { pluginId: surface }))
    assert.deepEqual(trace.at(-1), { ok: false, error: 'restoration-failed' })
    let finish
    f.root.odkRendererRuntime.setEnabled = () => new Promise(resolve => { finish = resolve })
    const pending = f.request('control', 'disable', { pluginId: surface })
    await f.close()
    finish()
    trace.push(await pending)
    assert.deepEqual(trace.at(-1), { ok: false, error: 'lifecycle-failed' })
    assert.equal(f.channels.size, 0)
    traces.push(trace)
  }
  assert.deepEqual(traces[1], traces[0])
})

test('failed Renderer bridge startup restores the previous diagnosis subscription', async t => {
  const f = await fixture(t)
  const runtime = f.root.odkRendererDiagnosis
  const peer = f.channels.get('control')
  const baseline = await f.request('diagnosis')
  const manifest = runtime.catalog().find(plugin => plugin.manifest.id === 'odk.renderer.plugin-diagnostics').manifest
  let released = false
  await assert.rejects(runtime.replace({ manifest: { ...manifest, version: '2.0.0' }, create(ctx) {
    ctx.onCleanup(() => { released = true })
    throw Error('Controlled bridge startup failure')
  } }), /replacement failed/)
  assert.equal(released, true)
  assert.equal(f.channels.get('control'), peer)
  assert.deepEqual(await f.request('diagnosis'), baseline)
})

test('selected diagnosis bridge preserves actual Electron reports and rejects a missing replacement',
  { timeout: 60000, skip: require('./not-ported').posixOnlyReason('unix-socket') }, async t => {
    const path = require('node:path')
    const os = require('node:os')
    const { runCommand, fixtureRejection } = require('./helpers/hydra-wire-lifecycle')
    const root = await fs.promises.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-br-'))
    t.after(() => fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    let baseline
    for (const mode of ['default', 'selected', 'missing']) {
      const directory = path.join(root, mode)
      const env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config'),
        XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state'),
        XDG_RUNTIME_DIR: path.join(directory, 'runtime'), ODK_WORKSPACE: path.join(directory, 'workspace'),
        ODK_RENDERER_BRIDGE_EXPECTED_VERSION: mode === 'default' ? '1.0.0' : '2.0.0' }
      delete env.ELECTRON_RUN_AS_NODE
      const running = runCommand(require('electron'), [path.join(__dirname, 'renderer-diagnosis-electron.cjs'),
        '--bridge-diagnosis-proof', ...(mode === 'selected' ? ['--selected-diagnosis-bridge'] : [])],
      { env, signal: t.signal, timeout: 15000, maxBuffer: 1024 * 1024 })
      if (mode === 'missing') await assert.rejects(running, error => fixtureRejection(error, /selected Renderer diagnosis bridge is missing/))
      else {
        const proof = JSON.parse((await running).stdout.trim().split('\n').pop()).bridgeDiagnosisSelection
        assert.equal(proof.version, env.ODK_RENDERER_BRIDGE_EXPECTED_VERSION)
        assert.equal(proof.documentRetained, true)
        assert.equal(proof.subscriptionReleased, true)
        const normalized = proof.plugins.map(plugin => plugin.manifest.id === 'odk.renderer.plugin-diagnostics'
          ? { ...plugin, manifest: { ...plugin.manifest, version: '1.0.0' } } : plugin)
        if (baseline) assert.deepEqual(normalized, baseline)
        else baseline = normalized
      }
    }
  })

for (const name of ['control', 'diagnosis']) {
  test(`trusted Renderer composition replaces the ${name} bridge and releases its subscription`, async t => {
    const f = await fixture(t)
    const runtime = f.root.odkRendererDiagnosis
    assert.equal(typeof runtime.replace, 'function')
    assert.equal(typeof runtime.catalog, 'function')
    const id = `odk.renderer.plugin-${name === 'control' ? 'control' : 'diagnostics'}`
    const peer = name === 'control' ? 'diagnosis' : 'control'
    const peerListener = f.channels.get(peer)
    const oldListener = f.channels.get(name)
    const manifest = runtime.catalog().find(plugin => plugin.manifest.id === id).manifest
    let constructions = 0
    await runtime.replace({ manifest: { ...manifest, version: '2.0.0' }, create(ctx) {
      constructions++
      const api = ctx.capability(name === 'control' ? 'renderer.control' : 'renderer.diagnosis')
      ctx.onCleanup(api.onRequest(request => {
        if (ctx.signal.aborted) return
        api.report(request.requestId, name === 'control'
          ? { ok: true, scope: 'electron-renderer', plugins: f.root.odkPlugins.catalog().map(plugin => ({ pluginId: plugin.manifest.id, host: 'electron-renderer' })) }
          : [...f.root.odkPlugins.catalog(), ...f.root.odkTheme.catalog(), ...runtime.catalog()])
      }))
      return {}
    } })
    assert.equal(constructions, 1)
    assert.notEqual(f.channels.get(name), oldListener)
    assert.equal(f.channels.get(peer), peerListener)
    assert.deepEqual(await f.request('control', 'inventory'), { ok: true, scope: 'electron-renderer',
      plugins: [{ pluginId: 'odk.tile.clock', host: 'electron-renderer' }] })
    const diagnostic = await f.request('diagnosis')
    const selected = diagnostic.find(plugin => plugin.manifest.id === id)
    assert.equal(selected.manifest.version, '2.0.0')
    assert.equal(selected.state, 'running')
    await assert.rejects(runtime.replace({ manifest: { ...manifest, host: 'electron-main' }, create() { throw Error('invalid factory ran') } }), /external contract/)
    assert.equal(runtime.catalog().find(plugin => plugin.manifest.id === id).manifest.version, '2.0.0')
    const before = f.reports.length
    oldListener({ requestId: 'old', command: 'inventory' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.reports.length, before)
    await f.close()
    assert.equal(f.channels.size, 0)
    await assert.rejects(runtime.replace({ manifest, create: () => ({}) }), /running Host/)
  })
}
