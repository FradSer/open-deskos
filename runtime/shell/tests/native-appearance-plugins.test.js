'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { createNativePluginStore } = require('../src/native-plugin-store')
const { createNativePluginManager } = require('../src/native-plugin-manager')
const { readConfig } = require('../src/plugin-config')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const { loadNativeAppearancePlugins } = require('../src/native-plugin-loader')
const api = require('../src/renderer/core/appearance-plugins')

async function fixture(t, { code = true, change = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-appearance-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  const original = api.createAppearancePlugins().find(plugin => plugin.manifest.id === 'odk.theme.pixel')
  const manifest = { ...original.manifest, version: '2.0.0', appearance: { theme: 'pixel', name: 'Pixel', css: 'themes/pixel.css',
    tokens: {}, faces: ['zpix'], extra: 'image-rendering:pixelated;' }, ...(code ? { entry: 'entry.js' } : {}), ...change }
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  const entry = `(() => { const original = window.odkAppearancePlugins.createAppearancePlugins().find(plugin => plugin.manifest.id === 'odk.theme.pixel');
    window.odkAppearanceNative.define({ id: 'odk.theme.pixel', appearance: structuredClone(original.appearance),
      create(ctx) { ctx.onCleanup(() => window.trace.push('cleanup')); window.trace.push('create');
        return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) }, start() { window.trace.push('start') },
          stop() { window.trace.push('stop') }, destroy() { window.trace.push('destroy') } }; } }); })();`
  if (code) await fs.writeFile(path.join(source, 'entry.js'), entry)
  const keys = crypto.generateKeyPairSync('ed25519')
  const keyring = new Map([['fixture', { publicKey: keys.publicKey, identities: ['odk.theme.pixel'], hosts: ['electron-renderer'] }]])
  const files = []
  for (const name of code ? ['entry.js', 'manifest.json'] : ['manifest.json']) files.push({ path: name,
    sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, name))).digest('hex') })
  const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
  await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload,
    signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
  const policy = path.join(root, 'publishers.json')
  await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), identities: ['odk.theme.pixel'], hosts: ['electron-renderer'],
  } } }))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), OPEN_DESKOS_NATIVE_KEYRING: policy }
  const store = createNativePluginStore({ stateDir: path.join(root, 'state', 'open-deskos', 'plugins', 'native'), keyring })
  const configPath = path.join(root, 'config', 'plugins.json')
  const manager = createNativePluginManager({ store, configPath })
  const assets = createNativeRendererAssets()
  t.after(() => assets.close())
  return { source, store, manager, assets, configPath, entry, manifest, env, policy }
}

test('native Appearance stages captures and discovers browser factory without changing the declaration contract', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const [selected] = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  assert.equal(selected.manifest.id, 'odk.theme.pixel')
  assert.match(selected.entryUrl, /^odk-native-plugin:/)
  assert.equal(await f.assets.response({ url: selected.entryUrl }).text(), f.entry)
  assert.throws(() => api.selectAppearancePlugins([f.manifest]), /appearance/)
})

test('signed palette declarations remain data selections without asset routes', async t => {
  const f = await fixture(t, { code: false })
  await f.manager.install(f.source, { trust: true, grants: [] })
  const [selected] = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  assert.equal(selected.entryUrl, undefined)
  assert.equal(api.selectAppearancePlugins([selected.manifest]).find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version, '2.0.0')
  assert.equal(f.assets.hasEntries(), false)
})

test('native Appearance cannot change the factory theme context and disabled selections expose no entry', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  assert.deepEqual(await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets, disabled: ['odk.theme.pixel'] }), [])
  const bad = await fixture(t, { change: { appearance: { ...f.manifest.appearance, tokens: { '--odk-primary': '#fafafa' } } } })
  await assert.rejects(bad.manager.install(bad.source, { trust: true, grants: [] }), /appearance/)
})

async function browser(entries, scripts, list) {
  const vm = require('node:vm')
  const listeners = new Map()
  const storage = new Map([['odk.theme', 'pixel']])
  const root = { trace: [], location: { search: '' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    odkRendererPluginBridge: { list: list || (async () => entries) },
    addEventListener(name, callback) { listeners.set(name, [...(listeners.get(name) || []), callback]) },
    removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== callback)) },
  }
  let executions = 0
  const document = { documentElement: { dataset: {} }, hidden: false, addEventListener() {}, querySelector: () => null,
    createElement: tag => ({ tag, dataset: {}, remove() {} }), head: { appendChild(element) {
      if (element.tag !== 'script') return
      executions++
      root.beforeScript?.(element)
      document.currentScript = element
      try { vm.runInContext(scripts.get(element.src), context) } catch {
        for (const callback of listeners.get('error') || []) callback({ filename: element.src })
      }
      document.currentScript = null
      element.onload()
    } } }
  root.document = document
  const context = vm.createContext({ window: root, document, structuredClone, AbortController, URLSearchParams, setTimeout, clearTimeout,
    console: { error() {} } })
  for (const file of ['plugin-host.js', 'renderer/core/appearance-plugins.js', 'renderer/core/development-plugins.js',
    'renderer/core/native-appearance.js', 'renderer/core/theme.js']) vm.runInContext(await fs.readFile(path.join(__dirname, '../src', file), 'utf8'), context)
  return { root, storage, executions: () => executions, pagehide: () => {
    for (const callback of listeners.get('pagehide') || []) callback({ persisted: false })
  } }
}

test('signed browser factory owns lifecycle and preserves complete theme data and saved preference', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  const b = await browser(entries, new Map([[entries[0].entryUrl, f.entry]]))
  assert.equal(b.root.odkTheme.get(), 'pixel')
  await b.root.odkTheme.ready
  assert.equal(b.root.odkTheme.catalog().find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version, '2.0.0')
  assert.deepEqual(b.root.trace, ['create', 'start'])
  await b.root.odkTheme.setEnabled('odk.theme.pixel', false)
  assert.equal(b.root.odkTheme.get(), 'instrument')
  assert.equal(b.storage.get('odk.theme'), 'pixel')
  await b.root.odkTheme.setEnabled('odk.theme.pixel', true)
  assert.equal(b.root.odkTheme.get(), 'pixel')
  assert.deepEqual(b.root.trace, ['create', 'start', 'stop', 'destroy', 'cleanup', 'create', 'start'])
  b.pagehide()
  await new Promise(setImmediate)
  assert.deepEqual(b.root.trace.slice(-3), ['stop', 'destroy', 'cleanup'])
})

test('failed and invalid signed Appearance entries leave packaged factories and preferences intact', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  for (const code of [f.entry + 'throw Error("after definition")',
    f.entry + "try { window.odkAppearanceNative.define({ id: 'odk.theme.pixel' }); } catch {}",
    f.entry.replace('appearance: structuredClone(original.appearance)', 'appearance: {}')]) {
    const b = await browser(entries, new Map([[entries[0].entryUrl, code]]))
    await b.root.odkTheme.ready
    assert.equal(b.root.odkTheme.catalog().find(plugin => plugin.manifest.id === 'odk.theme.pixel').manifest.version, '1.0.0')
    assert.deepEqual(b.root.trace, [])
    assert.equal(b.root.odkTheme.get(), 'pixel')
    assert.equal(b.storage.get('odk.theme'), 'pixel')
    b.pagehide()
  }
})

test('page shutdown during Appearance discovery prevents late script and factory execution', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  let resolve
  const pending = new Promise(done => { resolve = done })
  const b = await browser(entries, new Map([[entries[0].entryUrl, f.entry]]), () => pending)
  b.pagehide()
  resolve(entries)
  await b.root.odkTheme.ready
  assert.equal(b.executions(), 0)
  assert.deepEqual(b.root.trace, [])
  assert.ok(b.root.odkTheme.catalog().every(plugin => plugin.state !== 'running'))
})

test('signed Appearance recovery releases the external factory without discovery or preference writes', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  let discoveries = 0
  const b = await browser(entries, new Map([[entries[0].entryUrl, f.entry]]), async () => { discoveries++; return entries })
  await b.root.odkTheme.ready
  const before = b.root.odkTheme.catalog().filter(plugin => plugin.manifest.id !== 'odk.theme.pixel')
  let writes = 0
  b.root.localStorage.setItem = () => { writes++ }
  const receipt = await b.root.odkTheme.restoreDefault('odk.theme.pixel')
  assert.equal(receipt.version, '1.0.0')
  assert.equal(receipt.implementation, 'built-in')
  assert.deepEqual(b.root.trace, ['create', 'start', 'stop', 'destroy', 'cleanup'])
  assert.equal(b.executions(), 1)
  assert.equal(discoveries, 1)
  assert.equal(writes, 0)
  assert.equal(b.storage.get('odk.theme'), 'pixel')
  assert.equal(b.root.odkTheme.get(), 'pixel')
  assert.deepEqual(b.root.odkTheme.catalog().filter(plugin => plugin.manifest.id !== 'odk.theme.pixel'), before)
  b.pagehide()
  await assert.rejects(b.root.odkTheme.restoreDefault('odk.theme.pixel'), /shutting down/)
  await assert.rejects(b.root.odkTheme.setEnabled('odk.theme.pixel', true), /shutting down/)
  assert.equal(b.root.odkTheme.get(), 'pixel')
})

test('Appearance Main activation uses signed loading and revalidates policy before cached capture reuse', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const { createNativeRendererActivator } = require('../src/native-renderer-activation')
  const entries = []
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets, entries: () => entries,
    publishSelection(entry) { entries.splice(0, entries.length, entry) } })
  const before = await fs.readFile(f.configPath, 'utf8')
  const first = await activate('odk.theme.pixel')
  assert.equal(first.version, '2.0.0')
  assert.equal(await f.assets.response({ url: first.entryUrl }).text(), f.entry)
  assert.deepEqual(await activate('odk.theme.pixel'), first)
  await fs.writeFile(f.policy, JSON.stringify({ schemaVersion: 1, publishers: {} }))
  await assert.rejects(activate('odk.theme.pixel'))
  assert.equal(entries.length, 1)
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
})

test('Appearance Main activation rejects data-only palette selections without publication', async t => {
  const f = await fixture(t, { code: false })
  await f.manager.install(f.source, { trust: true, grants: [] })
  const { createNativeRendererActivator } = require('../src/native-renderer-activation')
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets, publishSelection() { assert.fail('palette cannot activate code') } })
  await assert.rejects(activate('odk.theme.pixel'), /selection unavailable/)
  assert.equal(f.assets.hasEntries(), false)
})

test('Appearance browser activation scopes the captured entry and preserves preferences without another default construction', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  const scripts = new Map([[entries[0].entryUrl, f.entry]])
  const b = await browser(entries, scripts)
  await b.root.odkTheme.ready
  await b.root.odkTheme.restoreDefault('odk.theme.pixel')
  const url = 'odk-native-plugin://' + 'a'.repeat(32) + '/entry.js'
  entries.splice(0, entries.length, { ...entries[0], entryUrl: url, manifest: { ...entries[0].manifest, version: '4.0.0' } })
  scripts.set(url, f.entry)
  let writes = 0
  b.root.localStorage.setItem = () => { writes++ }
  await assert.rejects(b.root.odkTheme.activate({ pluginId: 'odk.theme.pixel', entryUrl: url + '?stale', version: '4.0.0' }), /selection changed/)
  assert.equal(b.executions(), 1)
  await b.root.odkTheme.activate({ pluginId: 'odk.theme.pixel', entryUrl: url, version: '4.0.0' })
  assert.equal(b.root.odkTheme.catalog()[1].manifest.version, '4.0.0')
  assert.equal(b.executions(), 2)
  assert.equal(writes, 0)
  assert.equal(b.root.odkTheme.get(), 'pixel')
  assert.equal(b.storage.get('odk.theme'), 'pixel')
  await b.root.odkTheme.setEnabled('odk.theme.pixel', false)
  await assert.rejects(b.root.odkTheme.activate({ pluginId: 'odk.theme.pixel', entryUrl: url, version: '4.0.0' }), /enabled running/)
  assert.equal(b.executions(), 2)
  b.pagehide()
})

test('Appearance delayed definitions cannot impersonate a later captured script', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  const old = f.entry.replace('window.odkAppearanceNative.define({', 'window.savedDefinition = () => window.odkAppearanceNative.define({')
  const scripts = new Map([[entries[0].entryUrl, old]])
  const b = await browser(entries, scripts)
  await b.root.odkTheme.ready
  assert.equal(b.root.odkTheme.catalog()[1].manifest.version, '1.0.0')
  const url = 'odk-native-plugin://' + 'c'.repeat(32) + '/entry.js'
  entries[0] = { ...entries[0], entryUrl: url, manifest: { ...entries[0].manifest, version: '4.0.0' } }
  b.root.beforeScript = () => {
    assert.throws(() => b.root.savedDefinition(), /executing selected script/)
    b.root.staleRejected = true
  }
  scripts.set(url, f.entry)
  await b.root.odkTheme.activate({ pluginId: 'odk.theme.pixel', entryUrl: url, version: '4.0.0' })
  assert.equal(b.root.staleRejected, true)
  assert.equal(b.root.odkTheme.catalog()[1].manifest.version, '4.0.0')
  b.pagehide()
})

test('Appearance disable during runtime discovery prevents entry execution', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  let release; let entered; let calls = 0
  const waiting = new Promise(resolve => { entered = resolve })
  const pending = new Promise(resolve => { release = resolve })
  const b = await browser(entries, new Map([[entries[0].entryUrl, f.entry]]), () => ++calls === 1 ? entries : (entered(), pending))
  await b.root.odkTheme.ready
  const activated = assert.rejects(b.root.odkTheme.activate({ pluginId: 'odk.theme.pixel', version: '2.0.0', entryUrl: entries[0].entryUrl }))
  await waiting
  await b.root.odkTheme.setEnabled('odk.theme.pixel', false)
  release(entries)
  await activated
  assert.equal(b.executions(), 1)
  assert.equal(b.root.odkTheme.get(), 'instrument')
  b.pagehide()
})

for (const phase of ['create', 'start']) test(`Appearance Theme activation cancellation reaches candidate ${phase}`, async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const entries = await loadNativeAppearancePlugins(readConfig(f.configPath), { store: f.store, assets: f.assets })
  const scripts = new Map([[entries[0].entryUrl, f.entry]])
  const b = await browser(entries, scripts)
  await b.root.odkTheme.ready
  await b.root.odkTheme.restoreDefault('odk.theme.pixel')
  const url = 'odk-native-plugin://' + 'd'.repeat(32) + '/entry.js'
  entries[0] = { ...entries[0], entryUrl: url, manifest: { ...entries[0].manifest, version: '4.0.0' } }
  let code = f.entry.replace('create(ctx) {', 'async create(ctx) { window.candidateSignal = ctx.signal;')
  if (phase === 'create') code = code.replace('window.candidateSignal = ctx.signal;', 'window.candidateSignal = ctx.signal; window.enterCandidate(); await window.candidateGate;')
  else code = code.replace("start() { window.trace.push('start') }", "async start() { window.trace.push('start'); window.enterCandidate(); await window.candidateGate }")
  scripts.set(url, code)
  let release; let entered
  const waiting = new Promise(resolve => { entered = resolve })
  b.root.enterCandidate = entered
  b.root.candidateGate = new Promise(resolve => { release = resolve })
  const controller = new AbortController()
  const activated = assert.rejects(b.root.odkTheme.activate({ pluginId: 'odk.theme.pixel', entryUrl: url, version: '4.0.0' },
    { signal: controller.signal }), /replacement failed|cancelled|aborted/)
  await waiting
  controller.abort()
  assert.equal(b.root.candidateSignal.aborted, true)
  release()
  await activated
  assert.equal(b.root.odkTheme.catalog()[1].manifest.version, '1.0.0')
  assert.equal(b.root.odkTheme.catalog()[1].state, 'running')
  assert.deepEqual(b.root.trace.slice(-3), ['stop', 'destroy', 'cleanup'])
  assert.equal(b.root.odkTheme.get(), 'pixel')
  b.pagehide()
})

for (const fillDuringCapture of [false, true]) test(`Appearance activation refuses full discovery ${fillDuringCapture ? 'after' : 'before'} signed capture`, async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, { trust: true, grants: [] })
  const { createNativeRendererActivator } = require('../src/native-renderer-activation')
  let peers = Array.from({ length: fillDuringCapture ? 31 : 32 }, (_, index) => ({ manifest: { id: `odk.tile.capacity-${index}` } }))
  let loads = 0
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets, entries: () => peers,
    publishSelection() { assert.fail('full discovery must not publish') }, load: async (config, options) => {
      loads++
      const result = await loadNativeAppearancePlugins(config, options)
      peers.push({ manifest: { id: 'odk.tile.last-peer' } })
      return result
    } })
  await assert.rejects(activate('odk.theme.pixel'), /entry limit/)
  assert.equal(loads, fillDuringCapture ? 1 : 0)
  assert.equal(f.assets.hasEntries(), false)
  assert.equal(peers.length, 32)
})
