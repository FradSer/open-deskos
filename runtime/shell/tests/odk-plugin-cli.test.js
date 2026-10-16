const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { main, readConfig, resolveConfigPath, validateManifest } = require('../scripts/odk-plugin-cli')

test('CLI validate checks manifest schema version 1', t => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-test-'))
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  const validPath = path.join(tmpDir, 'manifest.json')
  fs.writeFileSync(validPath, JSON.stringify({
    schemaVersion: 1,
    id: 'odk.test.plugin',
    kind: 'service',
    host: 'electron-main',
    name: 'Test plugin',
    version: '1.0.0',
  }))

  const manifest = validateManifest(validPath)
  assert.equal(manifest.id, 'odk.test.plugin')

  const invalidPath = path.join(tmpDir, 'invalid.json')
  fs.writeFileSync(invalidPath, JSON.stringify({ schemaVersion: 2, id: 'test' }))
  assert.throws(() => validateManifest(invalidPath), /schema.*1/)
})

test('CLI rejects declarations rejected by the Host', t => {
  const { createPluginHost } = require('../src/plugin-host')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-manifest-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, 'manifest.json')
  const base = { schemaVersion: 1, id: 'odk.test.plugin', kind: 'service', host: 'electron-main', name: 'Test', version: '1.0.0' }
  const invalid = [
    { id: '../outside' }, { kind: 'widget' }, { host: 'unknown' }, { name: '' }, { version: 'latest' },
    { provides: {} }, { provides: [{ interface: 'invalid' }] },
    { provides: [{ interface: 'odk:test/v1', optional: true }] },
    { provides: [{ interface: 'odk:test/v1' }, { interface: 'odk:test/v1' }] },
    { requires: [{ interface: 'odk:test/v1', optional: 'true' }] },
    { requires: [{ interface: 'odk:test/v1', unknown: true }] },
    { permissions: ['ipc', 'ipc'] }, { permissions: ['../files'] }, { permissions: {} },
  ]
  for (const changes of invalid) {
    const manifest = { ...base, ...changes }
    fs.writeFileSync(target, JSON.stringify(manifest))
    let expected
    try { createPluginHost().register({ manifest, create() { return {} } }) } catch (error) { expected = error.message }
    assert.ok(expected, JSON.stringify(changes))
    assert.throws(() => validateManifest(target), error => error.message === expected, JSON.stringify(changes))
  }
})

test('manifest validation is pure and returns the Host normalized declaration without loading entry code', async t => {
  const { validatePluginManifest, createPluginHost } = require('../src/plugin-host')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-pure-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const entry = path.join(root, 'entry.js')
  const marker = path.join(root, 'executed')
  fs.writeFileSync(entry, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`)
  const original = { schemaVersion: 1, id: 'odk.test.plugin', kind: 'service', host: 'electron-main', name: 'Test', version: '1.0.0', entry,
    requires: [{ interface: 'odk:missing/v1' }], permissions: ['ipc'] }
  const file = path.join(root, 'manifest.json')
  fs.writeFileSync(file, JSON.stringify(original))
  const normalized = validateManifest(file)
  assert.deepEqual(normalized, validatePluginManifest(original))
  const host = createPluginHost()
  host.register({ manifest: original, create() { throw Error('must not execute') } })
  assert.deepEqual(host.list()[0].manifest, normalized)
  normalized.permissions.push('files')
  assert.deepEqual(original.permissions, ['ipc'])
  assert.equal(Object.hasOwn(original, 'provides'), false)
  assert.equal(fs.existsSync(marker), false)
  await assert.rejects(host.start(), /missing required port/)
  await host.stop()
  const ungranted = createPluginHost()
  ungranted.register({ manifest: { ...original, requires: [] }, create() { throw Error('must not execute') } })
  await ungranted.start()
  assert.equal(ungranted.list()[0].state, 'failed')
  assert.match(ungranted.list()[0].error, /missing capability ipc/)
  await ungranted.stop()
})

test('browser and Node exports validate the same manifest without loading a Node module', () => {
  const vm = require('node:vm')
  const { validatePluginManifest } = require('../src/plugin-host')
  const window = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/plugin-host.js'), 'utf8'), { window, structuredClone })
  const manifest = { schemaVersion: 1, id: 'odk.test.renderer', kind: 'surface', host: 'electron-renderer', name: 'Renderer', version: '1.0.0',
    requires: [{ interface: 'odk:optional/v1', optional: true }] }
  assert.deepEqual(JSON.parse(JSON.stringify(window.odkPluginHost.validatePluginManifest(manifest))), validatePluginManifest(manifest))
  assert.throws(() => window.odkPluginHost.validatePluginManifest({ ...manifest, permissions: ['../files'] }), /invalid plugin permissions/)
  assert.throws(() => window.odkPluginHost.createPluginHost().register({ manifest }), /requires a factory/)
})

test('CLI enables and disables plugins in config', t => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-cfg-'))
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  const env = { ODK_CONFIG_DIR: tmpDir }

  assert.equal(main(['enable', 'odk.test.clock'], env), 0)
  const config1 = readConfig(resolveConfigPath(env))
  assert.equal(config1.plugins['odk.test.clock'].enabled, true)

  assert.equal(main(['disable', 'odk.test.clock'], env), 0)
  const config2 = readConfig(resolveConfigPath(env))
  assert.equal(config2.plugins['odk.test.clock'].enabled, false)
})
