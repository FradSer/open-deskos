'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { createNativePluginStore } = require('../src/native-plugin-store')
const { createNativePluginManager } = require('../src/native-plugin-manager')
const { loadNativePlugins } = require('../src/native-plugin-loader')
const { readConfig } = require('../src/plugin-config')
const { createPluginHost } = require('../src/plugin-host')

async function fixture(t, { entry, extraFiles = {}, id = 'odk.test.native' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-loader-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  const keys = crypto.generateKeyPairSync('ed25519')
  const keyring = new Map([['fixture', { publicKey: keys.publicKey, identities: [id], hosts: ['electron-main'] }]])
  const env = { XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const { resolveShellHost } = require('../src/platform')
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins', 'native'), keyring })
  const configPath = path.join(root, 'config', 'plugins.json')
  const marker = path.join(root, 'executed')
  const manifest = { schemaVersion: 1, id, name: 'Native startup', version: '1.0.0', host: 'electron-main',
    kind: 'service', entry: 'entry.cjs', permissions: ['fixture'], provides: [{ interface: 'odk:test-native/v1' }], requires: [] }
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(source, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');
    const value = require('./value');
    exports.create = ctx => { const trace = ctx.capability('fixture'); ctx.onCleanup(() => trace.push('cleanup'));
      return { ports: { 'odk:test-native/v1': value }, start() { trace.push('start') }, stop() { trace.push('stop') }, destroy() { trace.push('destroy') } }; }`)
  await fs.writeFile(path.join(source, 'value.js'), 'module.exports = { value: 42 }')
  if (entry) await fs.writeFile(path.join(source, 'entry.cjs'), entry)
  for (const [name, content] of Object.entries(extraFiles)) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true })
    await fs.writeFile(path.join(source, name), content)
  }
  const files = []
  for (const file of ['entry.cjs', 'manifest.json', 'value.js', ...Object.keys(extraFiles)].sort()) files.push({ path: file,
    sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, file))).digest('hex') })
  const payload = { schemaVersion: 1, keyId: 'fixture', replace: false, files }
  const signature = crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64')
  await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload, signature }))
  await createNativePluginManager({ store, configPath }).install(source, { trust: true, grants: ['fixture'] })
  return { root, source, store, keyring, env, keys, config: readConfig(configPath), marker }
}

test('native discovery defers execution and captured entry and helpers survive retained-file mutation', async t => {
  const f = await fixture(t)
  const plugins = await loadNativePlugins(f.config, { store: f.store })
  assert.equal(plugins.length, 1)
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
  const pinned = await f.store.read(f.config.plugins['odk.test.native'].native.revision)
  await fs.writeFile(pinned.entry, 'throw Error("unverified entry must not execute")')
  await fs.writeFile(path.join(pinned.root, 'value.js'), 'throw Error("unverified helper must not execute")')
  const trace = []
  const host = createPluginHost({ capabilities: { fixture: trace } })
  plugins.forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.get('odk:test-native/v1').value, 42)
  await host.stop()
  assert.deepEqual(trace, ['start', 'stop', 'destroy', 'cleanup'])
})

test('native disabled grant-invalid and revoked selections execute no entries', async t => {
  const f = await fixture(t)
  assert.deepEqual(await loadNativePlugins(f.config, { store: f.store, disabled: ['odk.test.native'] }), [])
  const errors = []
  f.config.plugins['odk.test.native'].native.grants = []
  assert.deepEqual(await loadNativePlugins(f.config, { store: f.store, report: id => errors.push(id) }), [])
  assert.deepEqual(errors, ['odk.test.native'])
  f.config.plugins['odk.test.native'].native.grants = ['fixture']
  f.keyring.clear()
  assert.deepEqual(await loadNativePlugins(f.config, { store: f.store, report() {} }), [])
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
})

test('native Main startup without explicit policy preserves defaults and reports the rejected identity', async t => {
  const f = await fixture(t)
  const errors = []
  assert.deepEqual(await loadNativePlugins(f.config, { env: {}, report: id => errors.push(id) }), [])
  assert.deepEqual(errors, ['odk.test.native'])
  assert.deepEqual(await loadNativePlugins({ version: 1, plugins: {} }, { env: {} }), [])
})

test('native discovery rejects corrupt bytes and changed authorization before entry execution', async t => {
  for (const change of ['trust', 'identity', 'replacement', 'grants', 'corrupt']) {
    await t.test(change, async t => {
      const f = await fixture(t)
      const selection = f.config.plugins['odk.test.native'].native
      if (change === 'trust') selection.trustAcknowledgedAt = 'invalid'
      if (change === 'identity') {
        f.config.plugins['odk.test.other'] = f.config.plugins['odk.test.native']
        delete f.config.plugins['odk.test.native']
      }
      if (change === 'replacement') selection.replace = true
      if (change === 'grants') selection.grants.push('fixture')
      if (change === 'corrupt') await fs.writeFile((await f.store.read(selection.revision)).entry, 'unverified')
      const errors = []
      const plugins = await loadNativePlugins(f.config, { store: f.store, report: id => errors.push(id) })
      assert.deepEqual(plugins, [])
      assert.equal(errors.length, 1)
      await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
      const { createMainPlugins } = require('../src/plugins/main-composition')
      assert.deepEqual(createMainPlugins({ developmentPlugins: plugins }).map(plugin => plugin.manifest), createMainPlugins().map(plugin => plugin.manifest))
    })
  }
})

test('captured CommonJS resolves directories JSON and circular modules without disk reads', async t => {
  const f = await fixture(t, { entry: `const first = require('./cycle/a');
    const data = require('./data'); const dir = require('./dir');
    exports.create = () => ({ ports: { 'odk:test-native/v1': { first, data, dir } } });`,
  extraFiles: { 'cycle/a.js': "exports.name = 'a'; exports.b = require('./b').name",
    'cycle/b.js': "exports.name = 'b'; exports.a = require('./a').name", 'data.json': '{"value":42}',
    'dir/package.json': '{"main":"value.cjs"}', 'dir/value.cjs': "module.exports = 'directory'" } })
  const host = createPluginHost({ capabilities: { fixture: [] } })
  const plugins = await loadNativePlugins(f.config, { store: f.store })
  plugins.forEach(plugin => host.register(plugin))
  await host.start()
  assert.deepEqual(host.get('odk:test-native/v1'), { first: { name: 'a', b: 'b' }, data: { value: 42 }, dir: 'directory' })
  await host.stop()
})

test('cancelled creation does not evaluate captured native entry', async t => {
  const f = await fixture(t)
  const [plugin] = await loadNativePlugins(f.config, { store: f.store })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(plugin.create({ signal: controller.signal }), /cancelled/)
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
})

test('local modules absent from the signature cannot be required', async t => {
  const f = await fixture(t, { entry: "require('./unsigned'); exports.create = () => ({})" })
  const [plugin] = await loadNativePlugins(f.config, { store: f.store })
  const root = (await f.store.read(f.config.plugins['odk.test.native'].native.revision)).root
  await fs.writeFile(path.join(root, 'unsigned.js'), 'throw Error("unsigned code executed")')
  await assert.rejects(plugin.create({ signal: new AbortController().signal }), /absent from signed bundle/)
})

test('startup resolves the CLI state directory and explicit external publisher policy', async t => {
  const f = await fixture(t)
  const policy = path.join(f.root, 'publishers.json')
  await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: f.keys.publicKey.export({ type: 'spki', format: 'pem' }), identities: ['odk.test.native'], hosts: ['electron-main'],
  } } }))
  const env = { ...f.env, OPEN_DESKOS_NATIVE_KEYRING: policy }
  const plugins = await loadNativePlugins(f.config, { env })
  assert.equal(plugins.length, 1)
  const host = createPluginHost({ capabilities: { fixture: [] } })
  plugins.forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.get('odk:test-native/v1').value, 42)
  await host.stop()
  await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {} }))
  assert.deepEqual(await loadNativePlugins(f.config, { env, report() {} }), [])
})

test('captured root directory modules resolve signed index bytes', async t => {
  const f = await fixture(t, { entry: "const value = require('./'); exports.create = () => ({ ports: { 'odk:test-native/v1': value } })",
    extraFiles: { 'index.js': 'module.exports = { value: 42 }' } })
  const [plugin] = await loadNativePlugins(f.config, { store: f.store })
  const instance = await plugin.create({ signal: new AbortController().signal })
  assert.deepEqual(instance.ports['odk:test-native/v1'], { value: 42 })
})

test('native namespaces cannot overlap selected native or development owners', async t => {
  const parent = await fixture(t)
  const child = await fixture(t, { id: 'odk.test.native.child' })
  const config = { plugins: { ...parent.config.plugins, ...child.config.plugins } }
  const stores = [parent.store, child.store]
  const store = { async snapshot(revision) {
    for (const candidate of stores) {
      try { return await candidate.snapshot(revision) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    throw Error('missing revision')
  } }
  const errors = []
  assert.equal((await loadNativePlugins(config, { store, report: id => errors.push(id) })).length, 1)
  assert.deepEqual(errors, ['odk.test.native.child'])
  assert.deepEqual(await loadNativePlugins(child.config, { store: child.store,
    existingPlugins: [{ manifest: { id: 'odk.test.native' } }], report() {} }), [])
})

test('captured directories fall back to signed index when package main is absent', async t => {
  const f = await fixture(t, { entry: "const value = require('./dir'); exports.create = () => ({ ports: { 'odk:test-native/v1': value } })",
    extraFiles: { 'dir/package.json': '{"main":"missing.js"}', 'dir/index.js': 'module.exports = { value: 42 }' } })
  const [plugin] = await loadNativePlugins(f.config, { store: f.store })
  const instance = await plugin.create({ signal: new AbortController().signal })
  assert.deepEqual(instance.ports['odk:test-native/v1'], { value: 42 })
})

test('captured package self-directory main resolves its signed index', async t => {
  for (const main of ['.', './']) {
    const f = await fixture(t, { entry: "const value = require('./dir'); exports.create = () => ({ ports: { 'odk:test-native/v1': value } })",
      extraFiles: { 'dir/package.json': JSON.stringify({ main }), 'dir/index.js': 'module.exports = { value: 42 }' } })
    const [plugin] = await loadNativePlugins(f.config, { store: f.store })
    const instance = await plugin.create({ signal: new AbortController().signal })
    assert.deepEqual(instance.ports['odk:test-native/v1'], { value: 42 })
  }
})
