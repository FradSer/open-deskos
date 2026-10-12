'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runCommand: run } = require('./hydra-wire-lifecycle')
const { readConfig, resolveConfigPath } = require('../../src/plugin-config')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { resolveShellHost } = require('../../src/platform')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const id = 'odk.source.camera'

async function install(root, env, { signal } = {}) {
  signal?.throwIfAborted()
  const relative = path.relative(root, resolveShellHost({ env }).stateDir)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Camera fixture requires isolated state')
  const keys = crypto.generateKeyPairSync('ed25519')
  const fixture = path.join(__dirname, '../fixtures/camera-replacement')
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'))
  const entry = fs.readFileSync(path.join(fixture, 'entry.cjs'), 'utf8')
  const bundle = version => {
    const directory = path.join(root, version === '2.0.0' ? 'signed-camera' : `signed-camera-${version}`)
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version }))
    fs.writeFileSync(path.join(directory, 'entry.cjs'), `${entry}\nconst original = exports.create\nexports.create = context => {\n  const instance = original(context)\n  Object.defineProperty(instance.ports['odk:source/camera/v1'], 'fixtureRevision', { value: ${JSON.stringify(version)} })\n  return instance\n}\n`)
    const files = ['entry.cjs', 'manifest.json'].map(name => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }))
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
    fs.writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload,
      signature: crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64') }))
    return directory
  }
  const directory = bundle('2.0.0')
  const keyring = path.join(root, 'camera-publishers.json')
  fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: [id], hosts: ['electron-main'],
  } } }))
  env.ODK_NATIVE_KEYRING = keyring
  const command = args => run(process.execPath, [path.resolve(__dirname, '../../scripts/odk-plugin-cli.js'), 'native', ...args],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal })
  assert.equal(JSON.parse((await command(['install', directory, '--keyring', keyring, '--trust', '--grant', 'source.camera', '--grant', 'ipc'])).stdout).effect, 'selection-only')
  const config = () => readConfig(resolveConfigPath(env))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(config().plugins[id].native.revision)
  return { command, config, store, stored, keyring, bundle, load: () => loadNativePlugins(config(), { env }),
    mutate() { fs.writeFileSync(path.join(stored.root, 'entry.cjs'), 'throw Error("Stored Camera entry changed after discovery")') },
  }
}

module.exports = { install }
