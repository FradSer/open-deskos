const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function fixture(setEnabled = async () => {}) {
  const state = { value: 'running' }
  const reports = []
  let listener
  const root = { odkPlugins: { catalog: () => [{ manifest: { id: 'odk.tile.clock' }, state: state.value }], hasFailedPlacement: () => false },
    odkRendererRuntime: { setEnabled } }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/plugin-control.js', 'utf8'), { window: root })
  const signal = new AbortController()
  const cleanups = []
  root.odkRendererControlPlugin.create().create({ signal: signal.signal,
    capability: () => ({ onRequest(callback) { listener = callback; return () => { listener = null } },
      report(requestId, result) { reports.push({ requestId, result }) } }), onCleanup: callback => cleanups.push(callback) })
  return { root, state, reports, signal, async request(command, pluginId, selection = {}) {
    listener({ requestId: 'fixture', command, ...(pluginId ? { pluginId } : {}), ...selection })
    await new Promise(resolve => setImmediate(resolve))
    return JSON.parse(JSON.stringify(reports.at(-1).result))
  }, close() { cleanups.forEach(callback => callback()) } }
}

test('renderer control exposes only manageable identities and waits for coordinated lifecycle', async () => {
  let f
  f = fixture(async (_id, enabled) => { f.state.value = enabled ? 'running' : 'disabled' })
  assert.deepEqual(await f.request('inventory'), { ok: true, scope: 'electron-renderer',
    plugins: [{ pluginId: 'odk.tile.clock', host: 'electron-renderer' }] })
  assert.deepEqual(await f.request('disable', 'odk.tile.clock'), { ok: true, scope: 'electron-renderer', pluginId: 'odk.tile.clock', enabled: false, state: 'disabled' })
  assert.equal((await f.request('disable', 'odk.theme.pixel')).error, 'unknown-plugin')
  f.close()
})

test('App rejection and failed lifecycle cannot return successful renderer receipts', async () => {
  const f = fixture(async () => { throw Error('App surface must close; private detail') })
  assert.deepEqual(await f.request('disable', 'odk.tile.clock'), { ok: false, error: 'lifecycle-failed' })
  f.root.odkRendererRuntime.setEnabled = async () => {}
  assert.equal((await f.request('disable', 'odk.tile.clock')).error, 'lifecycle-failed')
  delete f.root.odkRendererRuntime
  assert.equal((await f.request('inventory')).error, 'runtime-unavailable')
  f.close()
})

test('late coordination completion after bridge shutdown cannot certify success', async () => {
  let release
  const f = fixture(() => new Promise(resolve => { release = resolve }))
  const pending = f.request('disable', 'odk.tile.clock')
  f.signal.abort()
  f.state.value = 'disabled'
  release()
  assert.equal((await pending).error, 'lifecycle-failed')
  f.close()
})

test('a running factory with failed affected placements cannot certify a successful enable', async () => {
  const f = fixture()
  f.root.odkPlugins.hasFailedPlacement = () => true
  assert.equal((await f.request('enable', 'odk.tile.clock')).error, 'lifecycle-failed')
  f.close()
})

test('renderer management inventories and routes appearance lifecycle without surface reconciliation', async () => {
  let surfaceCalls = 0
  const f = fixture(async () => { surfaceCalls++ })
  let state = 'running'
  const calls = []
  f.root.odkTheme = { catalog: () => [{ manifest: { id: 'odk.theme.pixel' }, state }],
    async setEnabled(id, enabled) { calls.push([id, enabled]); state = enabled ? 'running' : 'disabled' } }
  assert.deepEqual(await f.request('inventory'), { ok: true, scope: 'electron-renderer', plugins: [
    { pluginId: 'odk.tile.clock', host: 'electron-renderer' }, { pluginId: 'odk.theme.pixel', host: 'electron-renderer' },
  ] })
  assert.deepEqual(await f.request('disable', 'odk.theme.pixel'), { ok: true, scope: 'electron-renderer',
    pluginId: 'odk.theme.pixel', enabled: false, state: 'disabled' })
  assert.equal((await f.request('enable', 'odk.theme.pixel')).state, 'running')
  assert.deepEqual(calls, [['odk.theme.pixel', false], ['odk.theme.pixel', true]])
  assert.equal(surfaceCalls, 0)
  f.close()
})

test('failed appearance lifecycle and duplicate ownership cannot certify successful management', async () => {
  const f = fixture()
  let calls = 0
  let state = 'cleanup-failed'
  f.root.odkTheme = { catalog: () => [{ manifest: { id: 'odk.theme.pixel' }, state }],
    async setEnabled() { calls++ } }
  assert.equal((await f.request('disable', 'odk.theme.pixel')).error, 'lifecycle-failed')
  state = 'failed'
  assert.equal((await f.request('enable', 'odk.theme.pixel')).error, 'lifecycle-failed')
  f.root.odkTheme.catalog = () => [{ manifest: { id: 'odk.tile.clock' }, state: 'running' }]
  assert.equal((await f.request('disable', 'odk.tile.clock')).error, 'runtime-unavailable')
  assert.equal(calls, 2)
  f.close()
})

test('late appearance lifecycle after control shutdown cannot return success', async () => {
  const f = fixture()
  let release
  f.root.odkTheme = { catalog: () => [{ manifest: { id: 'odk.theme.pixel' }, state: 'disabled' }],
    setEnabled: () => new Promise(resolve => { release = resolve }) }
  const pending = f.request('disable', 'odk.theme.pixel')
  f.signal.abort()
  release()
  assert.equal((await pending).error, 'lifecycle-failed')
  f.close()
})

const selected = { revision: 'a'.repeat(64), version: '2.0.0', entryUrl: `odk-native-plugin://${'b'.repeat(32)}/entry.js` }
test('Renderer activation loads only Main captured selection and confirms selected running version', async () => {
  const f = fixture()
  let replacement
  f.root.odkRendererDevelopment = { async load(options) {
    assert.equal(options.runtime, true)
    assert.equal(options.pluginId, 'odk.tile.clock')
    assert.equal(options.entryUrl, selected.entryUrl)
    return [{ id: 'odk.tile.clock', manifest: { id: 'odk.tile.clock', version: selected.version } }]
  } }
  f.root.odkRendererRuntime.replace = async definition => { replacement = definition }
  f.root.odkPlugins.catalog = () => [{ manifest: { id: 'odk.tile.clock', version: replacement?.manifest.version || '1.0.0' }, state: 'running' }]
  assert.deepEqual(await f.request('activate', 'odk.tile.clock', selected), { ok: true, scope: 'electron-renderer',
    pluginId: 'odk.tile.clock', revision: selected.revision, version: selected.version, state: 'running' })
  f.close()
})

test('Renderer activation refuses stale definitions and cancellation before replacement', async () => {
  const f = fixture()
  let calls = 0
  f.root.odkRendererRuntime.replace = async () => { calls++ }
  f.root.odkRendererDevelopment = { load: async () => [{ id: 'odk.tile.clock', manifest: { version: '1.0.0' } }] }
  assert.equal((await f.request('activate', 'odk.tile.clock', selected)).error, 'activation-failed')
  let release
  f.root.odkRendererDevelopment.load = () => new Promise(resolve => { release = resolve })
  const pending = f.request('activate', 'odk.tile.clock', selected)
  f.signal.abort()
  release([{ id: 'odk.tile.clock', manifest: { version: selected.version } }])
  assert.equal((await pending).error, 'activation-failed')
  assert.equal(calls, 0)
  f.close()
})

test('Renderer control restores through coordinated captured defaults without loading external entries', async () => {
  const f = fixture()
  let calls = 0
  f.root.odkRendererDevelopment = { load() { throw Error('recovery must not load external code') } }
  f.root.odkRendererRuntime.restoreDefault = async pluginId => {
    assert.equal(pluginId, 'odk.tile.clock'); calls++
    return { implementation: 'built-in', version: '1.0.0', state: 'running' }
  }
  f.root.odkPlugins.catalog = () => [{ manifest: { id: 'odk.tile.clock', version: '1.0.0' }, state: 'running' }]
  assert.deepEqual(await f.request('restore-default', 'odk.tile.clock'), { ok: true, scope: 'electron-renderer',
    pluginId: 'odk.tile.clock', implementation: 'built-in', version: '1.0.0', state: 'running' })
  assert.equal(calls, 1)
  f.root.odkRendererRuntime.restoreDefault = async () => { throw Error('private cleanup failure') }
  assert.equal((await f.request('restore-default', 'odk.tile.clock')).error, 'restoration-failed')
  f.close()
})

test('Renderer control restores an Appearance default without placement reconciliation or external loading', async () => {
  const f = fixture(() => { throw Error('surface controller must not run') })
  let calls = 0
  f.root.odkTheme = { catalog: () => [{ manifest: { id: 'odk.theme.pixel', version: '1.0.0' }, state: 'running' }],
    async restoreDefault(id) { assert.equal(id, 'odk.theme.pixel'); calls++;
      return { implementation: 'built-in', version: '1.0.0', state: 'running' } } }
  f.root.odkRendererDevelopment = { load() { throw Error('external code must not load') } }
  assert.deepEqual(await f.request('restore-default', 'odk.theme.pixel'), { ok: true, scope: 'electron-renderer',
    pluginId: 'odk.theme.pixel', implementation: 'built-in', version: '1.0.0', state: 'running' })
  assert.equal(calls, 1)
  f.close()
})

test('Renderer activation routes an Appearance request through its factory owner', async () => {
  const f = fixture(() => { throw Error('surface must not execute') })
  const calls = []
  let version = '1.0.0'
  f.root.odkTheme = { catalog: () => [{ manifest: { id: 'odk.theme.pixel', version }, state: 'running' }],
    async activate(request, options) { calls.push(request); assert.equal(options.signal, f.signal.signal); version = request.version } }
  const selection = { revision: 'a'.repeat(64), version: '4.0.0', entryUrl: 'odk-native-plugin://' + 'b'.repeat(32) + '/entry.js' }
  assert.deepEqual(await f.request('activate', 'odk.theme.pixel', selection), { ok: true, scope: 'electron-renderer',
    pluginId: 'odk.theme.pixel', revision: selection.revision, version: selection.version, state: 'running' })
  assert.equal(calls.length, 1)
  f.close()
})
