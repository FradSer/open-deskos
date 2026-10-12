'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { prepare } = require('./helpers/hydra-surface-selection')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const { readConfig, writeConfig, resolveConfigPath } = require('../src/plugin-config')
const { createNativeRendererActivator } = require('../src/native-renderer-activation')
const id = 'odk.tile.hydra'

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-ra-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), XDG_RUNTIME_DIR: root }
  const directory = path.join(root, 'surface')
  fs.cpSync(path.join(__dirname, 'fixtures/hydra-surface-replacement'), directory, { recursive: true })
  const selection = await prepare(root, env, directory)
  env.OPEN_DESKOS_NATIVE_KEYRING = selection.keyring
  const assets = createNativeRendererAssets()
  const entries = []
  const activate = createNativeRendererActivator({ env, assets, publishSelection(entry) { entries.splice(0, entries.length, entry) } })
  t.after(() => { assets.close(); fs.rmSync(root, { recursive: true, force: true }) })
  return { env, assets, entries, activate, configPath: resolveConfigPath(env), ...selection }
}

test('Renderer preparation uses current signed selection and leaves configuration unchanged', async t => {
  const f = await fixture(t)
  for (const version of ['2.0.0', '3.0.0']) {
    if (version === '3.0.0') await f.command(['update', id, f.bundle(version), '--keyring', f.keyring, '--trust'])
    const before = fs.readFileSync(f.configPath, 'utf8')
    const result = await f.activate(id)
    assert.equal(result.version, version)
    assert.equal(result.revision, readConfig(f.configPath).plugins[id].native.revision)
    assert.equal(result.entryUrl, f.entries[0].entryUrl)
    assert.match(await f.assets.response({ url: result.entryUrl }).text(), new RegExp(version.replaceAll('.', '\\.')))
    assert.equal(fs.readFileSync(f.configPath, 'utf8'), before)
  }
})

test('Renderer preparation refuses revoked policy, disabled preferences, and changed signed bytes', async t => {
  const f = await fixture(t)
  const config = readConfig(f.configPath)
  config.plugins[id].enabled = false
  writeConfig(f.configPath, config)
  await assert.rejects(f.activate(id), /enabled signed Renderer/)
  config.plugins[id].enabled = true
  writeConfig(f.configPath, config)
  const policy = fs.readFileSync(f.keyring, 'utf8')
  fs.writeFileSync(f.keyring, JSON.stringify({ schemaVersion: 1, publishers: {} }))
  await assert.rejects(f.activate(id))
  fs.writeFileSync(f.keyring, policy)
  const stored = await f.store.read(config.plugins[id].native.revision)
  fs.writeFileSync(stored.entry, 'throw Error("mutated")')
  await assert.rejects(f.activate(id), /hash mismatch/)
  assert.equal(f.entries.length, 0)
  assert.equal(f.assets.hasEntries(), false)
})

test('Renderer publication fences cancellation and refuses runtime CSS before retaining assets', async t => {
  const f = await fixture(t)
  let release
  let capturedAssets
  const signal = new AbortController()
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets,
    publishSelection() { throw Error('must not publish') }, load: async (_config, options) => {
      capturedAssets = options.assets
      await new Promise(resolve => { release = resolve })
      return [options.assets.publish({})]
    } })
  const pending = activate(id, { signal: signal.signal })
  await new Promise(setImmediate)
  signal.abort()
  release()
  await assert.rejects(pending, /cancelled/)
  assert.equal(f.assets.hasEntries(), false)
  assert.throws(() => capturedAssets.publish({}), /cancelled/)
  const css = createNativeRendererActivator({ env: f.env, assets: f.assets, publishSelection() {},
    load: async (_config, options) => [options.assets.publish({ manifest: { css: 'style.css' } })] })
  await assert.rejects(css(id), /stylesheet/)
  assert.equal(f.assets.hasEntries(), false)
})

test('repeated activation revalidates the revision without retaining another immutable capture', async t => {
  const f = await fixture(t)
  const initial = await f.activate(id)
  for (let index = 0; index < 40; index++) assert.deepEqual(await f.activate(id), initial)
  const policy = fs.readFileSync(f.keyring, 'utf8')
  fs.writeFileSync(f.keyring, JSON.stringify({ schemaVersion: 1, publishers: {} }))
  await assert.rejects(f.activate(id))
  fs.writeFileSync(f.keyring, policy)
  assert.deepEqual(await f.activate(id), initial)
})

const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept }); return { promise, resolve } }

test('failed post-capture validation releases unpublished resources and allows repeated preparation', async t => {
  const f = await fixture(t)
  const urls = new Set()
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets,
    publishSelection() { throw Error('invalid preparation must not publish') },
    load: async (config, options) => {
      const entries = await loadNativeRendererPlugins(config, options)
      urls.add(entries[0].entryUrl)
      return []
    } })
  for (let index = 0; index < 40; index++) {
    await assert.rejects(activate(id), /selection unavailable/)
    assert.equal(f.assets.hasEntries(), false)
  }
  assert.equal(urls.size, 40)
  const valid = await f.activate(id)
  assert.equal(f.assets.response({ url: valid.entryUrl }).status, 200)
})

test('cancellation after signed capture releases resources before discovery publication', async t => {
  const f = await fixture(t)
  const entered = deferred(); const finish = deferred(); const controller = new AbortController()
  let url
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets, publishSelection() { throw Error('cancelled') },
    load: async (config, options) => {
      const entries = await loadNativeRendererPlugins(config, options)
      url = entries[0].entryUrl
      entered.resolve()
      await finish.promise
      return entries
    } })
  const operation = activate(id, { signal: controller.signal })
  const rejected = assert.rejects(operation, /cancelled/)
  await entered.promise
  assert.equal(f.assets.response({ url }).status, 200)
  controller.abort(); finish.resolve()
  await rejected
  assert.equal(f.assets.response({ url }).status, 404)
  assert.equal(f.assets.hasEntries(), false)
})

test('overlapping preparation retains a shared capture until every unpublished owner settles', async t => {
  const f = await fixture(t)
  const entered = [deferred(), deferred()]; const finish = [deferred(), deferred()]
  let count = 0; const urls = []
  const controller = new AbortController()
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets,
    publishSelection(entry) { f.entries.push(entry) }, load: async (config, options) => {
      const index = count++
      const entries = await loadNativeRendererPlugins(config, options)
      urls[index] = entries[0].entryUrl
      entered[index].resolve()
      await finish[index].promise
      return entries
    } })
  const first = activate(id, { signal: controller.signal })
  const rejected = assert.rejects(first, /cancelled/)
  await entered[0].promise
  const second = activate(id)
  await entered[1].promise
  assert.equal(urls[0], urls[1])
  controller.abort(); finish[0].resolve()
  await rejected
  assert.equal(f.assets.response({ url: urls[1] }).status, 200)
  finish[1].resolve()
  const published = await second
  assert.equal(published.entryUrl, urls[1])
  assert.equal(f.assets.response({ url: urls[1] }).status, 200)
})

test('failed later preparation preserves an already published capture', async t => {
  const f = await fixture(t)
  let fail = false
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets, publishSelection() {},
    load: async (config, options) => {
      const entries = await loadNativeRendererPlugins(config, options)
      if (fail) throw Error('controlled post-capture refusal')
      return entries
    } })
  const published = await activate(id)
  fail = true
  await assert.rejects(activate(id), /post-capture refusal/)
  assert.equal(f.assets.response({ url: published.entryUrl }).status, 200)
})

test('settled preparation cannot publish another capture through a retained loader callback', async t => {
  const f = await fixture(t)
  let publisher
  let plugin
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets, publishSelection() {},
    load: async (config, options) => {
      publisher = options.assets
      const wrapped = { ...options, assets: { publish(value) { plugin = value; return publisher.publish(value) } } }
      return loadNativeRendererPlugins(config, wrapped)
    } })
  await activate(id)
  assert.throws(() => publisher.publish(plugin), /preparation is closed/)
})

test('publication callback failure retains a capture that may already be externally visible', async t => {
  const f = await fixture(t)
  let entry
  const activate = createNativeRendererActivator({ env: f.env, assets: f.assets,
    publishSelection(value) { entry = value; throw Error('publication outcome uncertain') } })
  await assert.rejects(activate(id), /outcome uncertain/)
  assert.equal(f.assets.response({ url: entry.entryUrl }).status, 200)
})

test('later publication retains captured resources for already loaded definitions', async t => {
  const f = await fixture(t)
  const first = await f.activate(id)
  const original = await f.assets.response({ url: first.entryUrl }).text()
  await f.command(['update', id, f.bundle('3.0.0'), '--keyring', f.keyring, '--trust'])
  const second = await f.activate(id)
  assert.notEqual(first.entryUrl, second.entryUrl)
  assert.equal(f.assets.response({ url: first.entryUrl }).status, 200)
  assert.equal(await f.assets.response({ url: first.entryUrl }).text(), original)
  assert.equal(f.assets.response({ url: second.entryUrl }).status, 200)
})
