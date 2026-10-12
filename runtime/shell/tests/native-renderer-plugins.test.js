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
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-renderer-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await fs.mkdir(path.join(source, 'assets'), { recursive: true })
  const keys = crypto.generateKeyPairSync('ed25519')
  const keyring = new Map([['fixture', { publicKey: keys.publicKey, identities: ['odk.tile.clock'], hosts: ['electron-renderer'] }]])
  const store = createNativePluginStore({ stateDir: path.join(root, 'state'), keyring })
  const manifest = { schemaVersion: 1, id: 'odk.tile.clock', name: 'Signed Clock', version: '2.0.0', kind: 'surface',
    host: 'electron-renderer', surfaceKind: 'tile', interaction: 'display-only', entry: 'entry.js', css: 'assets/clock.css',
    provides: [{ interface: 'odk:surface/odk.tile.clock/v1' }], requires: [], permissions: [] }
  const code = "window.odkRendererDevelopment.define({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', mount(el) { el.textContent = 'signed'; } });"
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(source, 'entry.js'), code)
  await fs.writeFile(path.join(source, 'assets/clock.css'), '.signed { color: white; }')
  await fs.writeFile(path.join(source, 'assets/value.json'), '{"value":42}')
  const files = []
  for (const name of ['assets/clock.css', 'assets/value.json', 'entry.js', 'manifest.json']) files.push({ path: name,
    sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, name))).digest('hex') })
  const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
  await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload,
    signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
  const configPath = path.join(root, 'config', 'plugins.json')
  await createNativePluginManager({ store, configPath }).install(source, { trust: true, grants: [] })
  const assets = createNativeRendererAssets()
  t.after(() => assets.close())
  return { root, store, assets, config: readConfig(configPath), code, keyring }
}

test('signed Renderer discovery captures code CSS and nested assets before stored mutation', async t => {
  const f = await fixture(t)
  const [entry] = await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets })
  assert.equal(entry.manifest.id, 'odk.tile.clock')
  assert.match(entry.entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/entry\.js$/)
  const pinned = await f.store.read(f.config.plugins['odk.tile.clock'].native.revision)
  await fs.writeFile(pinned.entry, 'throw Error("unverified")')
  await fs.writeFile(pinned.css, 'body { display:none }')
  const code = f.assets.response({ url: entry.entryUrl, method: 'GET' })
  assert.equal(code.status, 200)
  assert.equal(await code.text(), f.code)
  assert.equal(code.headers.get('Content-Type'), 'text/javascript; charset=utf-8')
  assert.equal(await f.assets.response({ url: entry.cssUrl }).text(), '.signed { color: white; }')
  const valueUrl = new URL('value.json', entry.cssUrl).href
  assert.deepEqual(await f.assets.response({ url: valueUrl }).json(), { value: 42 })
  assert.equal(NATIVE_PLUGIN_SCHEME, 'odk-native-plugin')
})

test('native Renderer disables and revoked publishers expose no entry routes', async t => {
  const f = await fixture(t)
  assert.deepEqual(await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets, disabled: ['odk.tile.clock'] }), [])
  f.keyring.clear()
  const errors = []
  assert.deepEqual(await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets, report: id => errors.push(id) }), [])
  assert.deepEqual(errors, ['odk.tile.clock'])
})

test('asset authority rejects unknown routes methods and metadata and releases snapshots on close', async t => {
  const f = await fixture(t)
  const [entry] = await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets })
  for (const url of [entry.entryUrl + '?read=1', entry.entryUrl.replace('/entry.js', '/manifest.json'),
    entry.entryUrl.replace('/entry.js', '/missing.js'), entry.entryUrl.replace(/\/\/[a-f0-9]{32}/, '//unknown')]) {
    assert.equal(f.assets.response({ url }).status, 404)
  }
  assert.equal(f.assets.response({ url: entry.entryUrl, method: 'POST' }).status, 405)
  f.assets.close()
  assert.equal(f.assets.response({ url: entry.entryUrl }).status, 410)
})

for (const selected of [false, true]) {
  function discoveryPlugin() {
    const { createMainPlugins } = require('../src/plugins/main-composition')
    const id = 'odk.system.renderer-development'
    const replacement = selected ? require('./fixtures/renderer-development-replacement').independentRendererDevelopment() : null
    const plugins = createMainPlugins({ replacementPlugins: replacement ? [replacement] : [], onDefaults(defaults) {
      if (replacement) defaults.find(plugin => plugin.manifest.id === id).create = () => { throw Error('Default discovery refused') }
    } })
    const plugin = plugins.find(plugin => plugin.manifest.id === id)
    if (replacement) assert.equal(plugin, replacement)
    return plugin
  }

  test(`${selected ? 'selected' : 'default'} Renderer discovery owns protocol leases across disable enable and shutdown`, async t => {
    const f = await fixture(t)
    const entries = await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets })
    const { createPluginHost } = require('../src/plugin-host')
    const { RENDERER_DEVELOPMENT_CHANNEL } = require('../src/plugins/renderer-development')
    const routes = new Map()
    const handlers = new Map()
    const frame = {}
    const sender = { mainFrame: frame }
    const host = createPluginHost({ capabilities: { 'system.renderer-development': {
      nativeAssets: f.assets, protocol: { handle: (name, handler) => routes.set(name, handler), unhandle: name => routes.delete(name) },
      ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
      frames: () => [sender], entries: () => entries,
    } } })
    t.after(() => host.stop())
    host.register(discoveryPlugin())
    await host.start()
    const originalHandler = routes.get(NATIVE_PLUGIN_SCHEME)
    assert.equal(originalHandler({ url: entries[0].entryUrl }).status, 200)
    assert.throws(() => handlers.get(RENDERER_DEVELOPMENT_CHANNEL)({ sender, senderFrame: {} }), /refused/)
    await host.setEnabled('odk.system.renderer-development', false)
    assert.equal(routes.size, 0)
    assert.equal(originalHandler({ url: entries[0].entryUrl }).status, 410)
    await host.setEnabled('odk.system.renderer-development', true)
    assert.equal(routes.get(NATIVE_PLUGIN_SCHEME)({ url: entries[0].entryUrl }).status, 200)
    await host.stop()
    assert.equal(routes.size, 0)
    assert.equal(handlers.size, 0)
  })

  test(`${selected ? 'selected' : 'default'} runtime native discovery binds its route before entries and serves later verified captures`, async t => {
    const f = await fixture(t)
    const { createPluginHost } = require('../src/plugin-host')
    const { RENDERER_DEVELOPMENT_CHANNEL } = require('../src/plugins/renderer-development')
    const routes = new Map(), handlers = new Map()
    const sender = { mainFrame: {} }
    let entries = []
    const host = createPluginHost({ capabilities: { 'system.renderer-development': {
      nativeAssets: f.assets, runtimeNativeAssets: true,
      protocol: { handle: (name, handler) => routes.set(name, handler), unhandle: name => routes.delete(name) },
      ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
      frames: () => [sender], entries: () => entries,
    } } })
    host.register(discoveryPlugin())
    try {
      await host.start()
      const route = routes.get(NATIVE_PLUGIN_SCHEME)
      assert.equal(typeof route, 'function')
      assert.equal(route({ url: 'odk-native-plugin://' + '0'.repeat(32) + '/entry.js' }).status, 404)
      entries = await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets })
      assert.equal(routes.get(NATIVE_PLUGIN_SCHEME), route)
      assert.equal(await route({ url: entries[0].entryUrl }).text(), f.code)
      assert.equal(handlers.get(RENDERER_DEVELOPMENT_CHANNEL)({ sender, senderFrame: sender.mainFrame }), entries)
      assert.throws(() => handlers.get(RENDERER_DEVELOPMENT_CHANNEL)({ sender, senderFrame: {} }), /refused/)
      await host.stop()
      assert.equal(routes.size, 0)
      assert.equal(handlers.size, 0)
      assert.equal(route({ url: entries[0].entryUrl }).status, 410)
      assert.equal(f.assets.response({ url: entries[0].entryUrl }).status, 200)
      f.assets.close()
      assert.equal(f.assets.response({ url: entries[0].entryUrl }).status, 410)
    } finally { await host.stop() }
  })
}

test('Renderer permits signed asset fetches while installed HTML retains no connection authority', async () => {
  const shell = await fs.readFile(path.join(__dirname, '../src/renderer/index.html'), 'utf8')
  assert.match(shell, /connect-src odk-native-plugin:;/)
  const { USER_APP_CSP } = require('../src/user-app-content')
  assert.match(USER_APP_CSP, /connect-src 'none'/)
  assert.equal(USER_APP_CSP.includes('odk-native-plugin:'), false)
})

test('native selections share the Renderer entry limit with development selections', async t => {
  const f = await fixture(t)
  const existingPlugins = Array.from({ length: 32 }, (_, index) => ({ manifest: { id: `odk.test.n${index}` } }))
  const errors = []
  assert.deepEqual(await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets, existingPlugins,
    report: id => errors.push(id) }), [])
  assert.deepEqual(errors, ['odk.tile.clock'])
  assert.equal(f.assets.hasEntries(), false)
})

test('live native asset leases see later captured publications without changing snapshot leases', async t => {
  const f = await fixture(t)
  const live = f.assets.fork({ live: true })
  const isolated = f.assets.fork()
  const [entry] = await loadNativeRendererPlugins(f.config, { store: f.store, assets: f.assets })
  assert.equal(live.response({ url: entry.entryUrl }).status, 200)
  assert.equal(isolated.response({ url: entry.entryUrl }).status, 404)
  assert.throws(() => live.publish({}), /lease cannot publish/)
  const another = f.assets.fork({ live: true })
  live.close()
  assert.equal(live.hasEntries(), false)
  assert.equal(live.response({ url: entry.entryUrl }).status, 410)
  assert.equal(another.response({ url: entry.entryUrl }).status, 200)
  assert.equal(f.assets.response({ url: entry.entryUrl }).status, 200)
  f.assets.close()
  assert.equal(another.response({ url: entry.entryUrl }).status, 410)
  isolated.close()
  another.close()
})

test('publisher retirement frees entry capacity and preserves independent snapshots', async t => {
  const f = await fixture(t)
  const snapshot = await f.store.snapshot(f.config.plugins['odk.tile.clock'].native.revision)
  const plugin = { ...await f.store.read(f.config.plugins['odk.tile.clock'].native.revision), files: snapshot.files }
  const entries = Array.from({ length: 32 }, () => f.assets.publish(plugin))
  const independent = f.assets.fork()
  const live = f.assets.fork({ live: true })
  t.after(() => { independent.close(); live.close() })
  assert.throws(() => f.assets.publish(plugin), /entry limit/)
  assert.throws(() => live.retire(entries[0].entryUrl), /lease cannot retire/)
  assert.equal(f.assets.retire(entries[0].cssUrl), false, 'only the exact entry authority can retire a bundle')
  assert.equal(f.assets.retire(entries[0].entryUrl), true)
  assert.equal(f.assets.retire(entries[0].entryUrl), false)
  assert.equal(f.assets.response({ url: entries[0].entryUrl }).status, 404)
  assert.equal(live.response({ url: entries[0].entryUrl }).status, 404)
  assert.equal(independent.response({ url: entries[0].entryUrl }).status, 200)
  const replacement = f.assets.publish(plugin)
  assert.notEqual(replacement.entryUrl, entries[0].entryUrl)
  assert.equal(f.assets.response({ url: replacement.entryUrl }).status, 200)
  assert.equal(f.assets.response({ url: entries[1].entryUrl }).status, 200)
})

test('publisher retirement returns retained byte capacity', t => {
  const assets = createNativeRendererAssets()
  t.after(() => assets.close())
  const plugin = { root: '/fixture', entry: '/fixture/entry.js', manifest: { id: 'odk.tile.fixture' },
    files: new Map([['entry.js', Buffer.from('// fixture')], ['large.png', Buffer.alloc(40 * 1024 * 1024)]]) }
  const earlyLive = assets.fork({ live: true })
  const entry = assets.publish(plugin)
  const lateLive = assets.fork({ live: true })
  const occupied = earlyLive.fork()
  t.after(() => { earlyLive.close(); lateLive.close(); occupied.close() })
  assert.throws(() => occupied.publish(plugin), /memory limit/)
  assert.throws(() => assets.publish(plugin), /memory limit/)
  assert.equal(assets.retire(entry.entryUrl), true)
  const emptied = lateLive.fork()
  t.after(() => emptied.close())
  assert.equal(emptied.hasEntries(), false)
  assert.equal(emptied.response({ url: emptied.publish(plugin).entryUrl }).status, 200)
  const next = assets.publish(plugin)
  assert.equal(assets.response({ url: next.entryUrl }).status, 200)
  assets.close()
  assert.throws(() => assets.retire(next.entryUrl), /closed/)
})
