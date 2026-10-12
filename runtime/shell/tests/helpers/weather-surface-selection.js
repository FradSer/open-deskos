'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runCommand } = require('./hydra-wire-lifecycle')
const { resolveShellHost } = require('../../src/platform')
const { readConfig, resolveConfigPath } = require('../../src/plugin-config')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { loadNativeRendererPlugins } = require('../../src/native-plugin-loader')

async function prepare(root, env, directory, { signal } = {}) {
  signal?.throwIfAborted()
  const relative = path.relative(root, resolveShellHost({ env }).stateDir)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Surface fixture requires private state')
  const keys = crypto.generateKeyPairSync('ed25519')
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  const entry = fs.readFileSync(path.join(directory, 'entry.js'), 'utf8')
  const css = fs.readFileSync(path.join(directory, 'weather.css'))
  const sign = (target, version) => {
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ ...manifest, version }))
    fs.writeFileSync(path.join(target, 'entry.js'), entry.replace("element.dataset.fixtureSurface = 'independent-weather'",
      `element.dataset.fixtureSurface = 'independent-weather'; element.dataset.fixtureSurfaceRevision = ${JSON.stringify(version)}`))
    fs.writeFileSync(path.join(target, 'weather.css'), css)
    const files = ['entry.js', 'manifest.json', 'weather.css'].map(name => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(target, name))).digest('hex') }))
    const payload = { schemaVersion: 1, keyId: 'surface-fixture', replace: true, files }
    const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
    fs.writeFileSync(path.join(target, 'bundle.json'), JSON.stringify({ ...payload, signature }))
    return target
  }
  sign(directory, manifest.version)
  const keyring = path.join(root, 'surface-publishers.json')
  fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: { 'surface-fixture': {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.tile.weather'], hosts: ['electron-renderer'],
  } } }))
  const command = args => runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), 'native',
    ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal, timeout: 10000 })
  const result = await command(['install', directory, '--keyring', keyring, '--trust'])
  assert.equal(JSON.parse(result.stdout).effect, 'selection-only')
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'),
    keyring: await readNativeKeyring(keyring) })
  return { keyring, command, store, bundle(version) {
    assert.ok(['2.0.0', '3.0.0'].includes(version), 'Unsupported surface fixture revision')
    const target = path.join(root, `surface-revision-${version}`)
    fs.mkdirSync(target)
    return sign(target, version)
  } }
}

async function capture(env, keyring, assets, { mutate = true, productionPolicy = false } = {}) {
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'),
    keyring: await readNativeKeyring(keyring) })
  const config = readConfig(resolveConfigPath(env))
  const revision = config.plugins['odk.tile.weather']?.native?.revision
  if (!revision) {
    const entries = await loadNativeRendererPlugins(config, { env, assets })
    assert.equal(entries.length, 0)
    return entries
  }
  const original = await store.snapshot(revision)
  const entries = await loadNativeRendererPlugins(config, productionPolicy ? { env, assets } : { store, assets })
  assert.equal(entries.length, 1)
  assert.match(entries[0].entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/entry\.js$/)
  assert.match(entries[0].cssUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/weather\.css$/)
  if (!mutate) return entries
  const stored = await store.read(revision)
  fs.writeFileSync(stored.entry, 'throw Error("Stored surface changed after capture")')
  fs.writeFileSync(stored.css, 'body { display: none }')
  assert.equal(await assets.response({ url: entries[0].entryUrl }).text(), original.files.get('entry.js').toString())
  assert.equal(await assets.response({ url: entries[0].cssUrl }).text(), original.files.get('weather.css').toString())
  await assert.rejects(store.snapshot(revision), /native file hash mismatch/)
  return entries
}

module.exports = { prepare, capture }
