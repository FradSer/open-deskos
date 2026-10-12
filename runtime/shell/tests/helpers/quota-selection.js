'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runCommand: run } = require('./hydra-wire-lifecycle')
const { readConfig, resolveConfigPath } = require('../../src/plugin-config')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { resolveShellHost } = require('../../src/platform')
const id = 'odk.source.quota'

async function install(root, env, { signal } = {}) {
  signal?.throwIfAborted()
  const relative = path.relative(root, resolveShellHost({ env }).stateDir)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Quota fixture requires isolated state')
  const selected = [id]
  const keys = crypto.generateKeyPairSync('ed25519')
  const keyring = path.join(root, 'quota-publishers.json')
  fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: selected, hosts: ['electron-main'],
  } } }))
  env.OPEN_DESKOS_NATIVE_KEYRING = keyring
  const command = args => run(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), 'native', ...args],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal })
  const bundle = (pluginId, version = '2.0.0') => {
    assert.ok(selected.includes(pluginId))
    const source = pluginId.replace('odk.source.', '')
    const directory = path.join(root, `${source}-${version}-bundle`)
    fs.cpSync(path.join(__dirname, `../fixtures/${source}-replacement`), directory, { recursive: true })
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
    manifest.version = version
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
    fs.appendFileSync(path.join(directory, 'entry.cjs'), `\nconst original = exports.create\nexports.create = context => {\n  const instance = original(context)\n  Object.defineProperty(instance.ports[${JSON.stringify(`odk:source/${source}/v1`)}], 'fixtureRevision', { value: ${JSON.stringify(version)} })\n  return instance\n}\n`)
    const files = ['entry.cjs', 'manifest.json'].map(name => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }))
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
    const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
    fs.writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
    return directory
  }
  for (const pluginId of selected) {
    const directory = bundle(pluginId)
    const source = pluginId.replace('odk.source.', '')
    const receipt = JSON.parse((await command(['install', directory, '--keyring', keyring, '--trust', '--grant', `source.${source}`, '--grant', 'ipc'])).stdout)
    assert.equal(receipt.effect, 'selection-only')
  }
  const config = () => readConfig(resolveConfigPath(env))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(config().plugins[id].native.revision)
  return { stored, command, config, store, keyring, bundle,
    load: options => loadNativePlugins(config(), { env, ...options }) }
}

module.exports = { install }
