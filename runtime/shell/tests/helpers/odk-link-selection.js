'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { runCommand } = require('./hydra-wire-lifecycle')
const { readConfig, resolveConfigPath } = require('../../src/plugin-config')
const { loadDevelopmentPlugins } = require('../../src/development-plugins')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { resolveShellHost } = require('../../src/platform')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')

async function select(root, mode, env, signal) {
  const relative = path.relative(root, resolveShellHost({ env }).stateDir)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Open DeskOS Link fixture requires isolated state')
  if (mode === 'default') return []
  const cli = path.resolve(__dirname, '../../scripts/odk-plugin-cli.js')
  const fixture = path.resolve(__dirname, '../fixtures/odk-link-replacement')
  const run = args => runCommand(process.execPath, [cli, ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal })
  if (mode === 'linked') {
    await run(['link', fixture, '--replace', '--trust', '--grant', 'source.odk-link'])
    return loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
  }
  const native = await install(root, env, signal)
  const plugins = await loadNativePlugins(native.config(), { env })
  assert.equal(plugins.length, 1)
  fs.writeFileSync(path.join(native.stored.root, 'entry.cjs'), 'throw Error("Open DeskOS Link stored entry changed after capture")')
  return plugins
}

async function install(root, env, signal) {
  const relative = path.relative(root, resolveShellHost({ env }).stateDir)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Open DeskOS Link fixture requires isolated state')
  const cli = path.resolve(__dirname, '../../scripts/odk-plugin-cli.js')
  const fixture = path.resolve(__dirname, '../fixtures/odk-link-replacement')
  const command = args => runCommand(process.execPath, [cli, 'native', ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal })
  const keys = crypto.generateKeyPairSync('ed25519')
  const bundle = version => {
    const directory = path.join(root, `signed-odk-link-${version}`)
    fs.mkdirSync(directory)
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json'), 'utf8'))
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version }))
    const entry = fs.readFileSync(path.join(fixture, 'entry.cjs'), 'utf8')
    fs.writeFileSync(path.join(directory, 'entry.cjs'), `${entry}\nconst original = exports.create\nexports.create = context => {\n  const instance = original(context)\n  instance.ports['odk:source/link/v1'].fixtureRevision = ${JSON.stringify(version)}\n  return instance\n}\n`)
    const files = ['entry.cjs', 'manifest.json'].map(name => ({ path: name,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }))
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
    fs.writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload,
      signature: crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64') }))
    return directory
  }
  const directory = bundle('2.0.0')
  const keyring = path.join(root, 'publishers.json')
  fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
    identities: ['odk.source.odk-link'], hosts: ['electron-main'],
  } } }))
  env.ODK_NATIVE_KEYRING = keyring
  assert.equal(JSON.parse((await command(['install', directory, '--keyring', keyring, '--trust', '--grant', 'source.odk-link'])).stdout).effect, 'selection-only')
  const config = () => readConfig(resolveConfigPath(env))
  const revision = config().plugins['odk.source.odk-link'].native.revision
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'),
    keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(revision)
  return { config, command, store, stored, bundle, keyring }
}

module.exports = { select, install }
