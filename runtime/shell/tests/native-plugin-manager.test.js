'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { createNativePluginStore } = require('../src/native-plugin-store')
const { createNativePluginManager } = require('../src/native-plugin-manager')
const { readConfig, updateConfig } = require('../src/plugin-config')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-manager-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  const keys = crypto.generateKeyPairSync('ed25519')
  const keyring = new Map([['fixture', { publicKey: keys.publicKey, identities: ['odk.test.native'], hosts: ['electron-main'] }]])
  const store = createNativePluginStore({ stateDir: path.join(root, 'state'), keyring })
  const configPath = path.join(root, 'config', 'plugins.json')
  const manifest = { schemaVersion: 1, id: 'odk.test.native', name: 'Native fixture', version: '1.0.0', host: 'electron-main',
    kind: 'service', entry: 'entry.cjs', provides: [], requires: [], permissions: ['fixture'] }
  async function write(overrides = {}) {
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, ...overrides }))
    await fs.writeFile(path.join(source, 'entry.cjs'), 'throw Error("entries must not execute during selection")')
    const files = []
    for (const file of ['entry.cjs', 'manifest.json']) files.push({ path: file,
      sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, file))).digest('hex') })
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: false, files }
    const signature = crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64')
    await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload, signature }))
  }
  await write()
  const authorization = { trust: true, grants: ['fixture'] }
  return { root, source, configPath, store, keyring, write, authorization,
    manager: createNativePluginManager({ store, configPath }), selected: () => readConfig(configPath).plugins['odk.test.native'] }
}

test('native install update rollback and removal preserve authorized history and unrelated preferences', async t => {
  const f = await fixture(t)
  updateConfig(f.configPath, config => { config.plugins['odk.test.native'] = { enabled: false }; config.plugins['odk.tile.clock'] = { enabled: false } })
  const first = await f.manager.install(f.source, f.authorization)
  assert.equal(f.selected().enabled, false)
  await f.write({ version: '2.0.0' })
  const second = await f.manager.update('odk.test.native', f.source, f.authorization)
  assert.notEqual(second.revision, first.revision)
  assert.equal(f.selected().native.previous.revision, first.revision)
  assert.equal((await f.manager.inspect('odk.test.native')).manifest.version, '2.0.0')
  await f.manager.rollback('odk.test.native')
  assert.equal(f.selected().native.revision, first.revision)
  assert.equal(f.selected().native.previous.revision, second.revision)
  await f.manager.remove('odk.test.native')
  assert.deepEqual(f.selected(), { enabled: false })
  assert.equal(readConfig(f.configPath).plugins['odk.tile.clock'].enabled, false)
  assert.equal((await f.store.read(first.revision)).manifest.version, '1.0.0')
  assert.equal((await f.store.read(second.revision)).manifest.version, '2.0.0')
  await fs.stat(path.join(f.source, 'entry.cjs'))
})

test('native selection requires explicit trust and exact independent grants', async t => {
  const f = await fixture(t)
  for (const authorization of [{ grants: ['fixture'] }, { trust: true, grants: [] },
    { trust: true, grants: ['fixture', 'fixture'] }, { trust: true, grants: ['fixture', 'outside'] }]) {
    await assert.rejects(f.manager.install(f.source, authorization), /trust|grant/)
  }
  assert.equal(f.selected(), undefined)
})

test('failed update verification or public contract change preserves complete selected configuration', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, f.authorization)
  const bytes = await fs.readFile(f.configPath, 'utf8')
  await fs.writeFile(path.join(f.source, 'entry.cjs'), 'unsigned change')
  await assert.rejects(f.manager.update('odk.test.native', f.source, f.authorization), /hash/)
  await f.write({ version: '2.0.0', provides: [{ interface: 'odk:changed/v1' }] })
  await assert.rejects(f.manager.update('odk.test.native', f.source, f.authorization), /contract/)
  assert.equal(await fs.readFile(f.configPath, 'utf8'), bytes)
})

test('rollback revalidates stored bytes and current publisher policy', async t => {
  const f = await fixture(t)
  const first = await f.manager.install(f.source, f.authorization)
  await f.write({ version: '2.0.0' })
  await f.manager.update('odk.test.native', f.source, f.authorization)
  const bytes = await fs.readFile(f.configPath, 'utf8')
  const pinned = await f.store.read(first.revision)
  await fs.writeFile(pinned.entry, 'corrupt prior revision')
  await assert.rejects(f.manager.rollback('odk.test.native'), /hash/)
  assert.equal(await fs.readFile(f.configPath, 'utf8'), bytes)
  f.keyring.clear()
  await assert.rejects(f.manager.inspect('odk.test.native'), /publisher/)
})

test('native and development ownership cannot overwrite each other', async t => {
  const f = await fixture(t)
  updateConfig(f.configPath, config => { config.plugins['odk.test.native'] = { development: {
    path: f.source, host: 'electron-main', grants: ['fixture'], trustAcknowledgedAt: new Date().toISOString() } } })
  const bytes = await fs.readFile(f.configPath, 'utf8')
  await assert.rejects(f.manager.install(f.source, f.authorization), /ownership/)
  assert.equal(await fs.readFile(f.configPath, 'utf8'), bytes)
})

test('concurrent native updates reject stale selections without losing enabled preference changes', async t => {
  const f = await fixture(t)
  await f.manager.install(f.source, f.authorization)
  await f.write({ version: '2.0.0' })
  let entered = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  let ready
  const both = new Promise(resolve => { ready = resolve })
  const store = { ...f.store, async stage(source) {
    const result = await f.store.stage(source)
    if (++entered === 2) ready()
    await gate
    return result
  } }
  const manager = createNativePluginManager({ store, configPath: f.configPath })
  const updates = [manager.update('odk.test.native', f.source, f.authorization), manager.update('odk.test.native', f.source, f.authorization)]
  await both
  updateConfig(f.configPath, config => { config.plugins['odk.test.native'].enabled = false })
  release()
  const results = await Promise.allSettled(updates)
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(results.find(result => result.status === 'rejected').reason.message, /selection changed/)
  assert.equal(f.selected().enabled, false)
  assert.equal((await manager.inspect('odk.test.native')).manifest.version, '2.0.0')
})

test('rollback refuses corrupt active revisions and incompatible signed history', async t => {
  for (const failure of ['active', 'contract']) {
    const f = await fixture(t)
    await f.manager.install(f.source, f.authorization)
    await f.write({ version: '2.0.0' })
    const current = await f.manager.update('odk.test.native', f.source, f.authorization)
    if (failure === 'active') {
      const pinned = await f.store.read(current.revision)
      await fs.writeFile(pinned.entry, 'corrupt active revision')
    } else {
      await f.write({ version: '3.0.0', provides: [{ interface: 'odk:changed/v1' }] })
      const incompatible = await f.store.stage(f.source)
      updateConfig(f.configPath, config => { config.plugins['odk.test.native'].native.previous.revision = incompatible.revision })
    }
    const bytes = await fs.readFile(f.configPath, 'utf8')
    await assert.rejects(f.manager.rollback('odk.test.native'), failure === 'active' ? /hash/ : /contract/)
    assert.equal(await fs.readFile(f.configPath, 'utf8'), bytes)
  }
})
