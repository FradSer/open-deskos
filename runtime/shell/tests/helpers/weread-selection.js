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
const id = 'odk.source.weread'
const modules = ['plugins/readings/weread.js', 'plugins/readings/common.js', 'plugins/health.js']

async function install(root, env, { signal } = {}) {
  signal?.throwIfAborted()
  const relative = path.relative(root, resolveShellHost({ env }).stateDir)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'WeRead fixture requires isolated state')
  const keys = crypto.generateKeyPairSync('ed25519')
  const entry = fs.readFileSync(path.join(__dirname, '../fixtures/weread-replacement/entry.cjs'), 'utf8')
    .replace("require('../../../src/plugins/readings/weread')", "require('./plugins/readings/weread')")
  const bundle = version => {
    const directory = path.join(root, version === '2.0.0' ? 'signed-weread' : `signed-weread-${version}`)
    fs.mkdirSync(directory)
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/weread-replacement/manifest.json'), 'utf8'))
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version }))
    fs.writeFileSync(path.join(directory, 'entry.cjs'), `${entry}\nconst original = exports.create\nexports.create = context => {\n  const instance = original(context)\n  Object.defineProperty(instance.ports['odk:source/weread/v1'], 'fixtureRevision', { value: ${JSON.stringify(version)} })\n  return instance\n}\n`)
    for (const name of modules) {
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
      fs.copyFileSync(path.join(__dirname, '../../src', name), path.join(directory, name))
    }
    const files = ['entry.cjs', 'manifest.json', ...modules].sort().map(name => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }))
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
    const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
    fs.writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
    return directory
  }
  const directory = bundle('2.0.0')
  const keyring = path.join(root, 'weread-publishers.json')
  fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: [id], hosts: ['electron-main'],
  } } }))
  env.ODK_NATIVE_KEYRING = keyring
  const command = args => run(process.execPath, [path.resolve(__dirname, '../../scripts/odk-plugin-cli.js'), 'native', ...args],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal, timeout: 10000 })
  const receipt = JSON.parse((await command(['install', directory, '--keyring', keyring, '--trust', '--grant', 'source.weread', '--grant', 'ipc'])).stdout)
  assert.equal(receipt.effect, 'selection-only')
  const config = () => readConfig(resolveConfigPath(env))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(config().plugins[id].native.revision)
  return { directory, stored, store, command, config, bundle, keyring,
    load: options => loadNativePlugins(config(), { env, ...options }),
    mutate() {
      for (const name of ['entry.cjs', ...modules]) fs.writeFileSync(path.join(stored.root, name), 'throw Error("Stored WeRead module changed after discovery")')
    },
  }
}

function surfaceTimeouts(platform = process.platform) {
  // Linux runs thirty fresh documents; measured complete halves exceed the original aggregate budget.
  return platform === 'linux'
    ? { fixture: 90000, child: 100000, test: 130000, revisions: 420000 }
    : { fixture: 45000, child: 55000, test: 60000, revisions: 180000 }
}

module.exports = { install, surfaceTimeouts }
