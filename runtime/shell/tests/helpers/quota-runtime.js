'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const run = require('node:util').promisify(require('node:child_process').execFile)
const { createPluginHost } = require('../../src/plugin-host')
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createShellDeskData } = require('../../src/desk-data')
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')
const { loadDevelopmentPlugins } = require('../../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../../src/plugin-config')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { resolveShellHost } = require('../../src/platform')
const directory = path.join(__dirname, '../fixtures/quota-replacement')
const cli = path.join(__dirname, '../../scripts/open-deskos-plugin-cli.js')
const id = 'odk.source.quota'
const channel = 'odk-opencode-go-status'

async function fixture(t, replacement, read, { mutateCaptured = true, ipc } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-qparity-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let replacements = []
  let native
  if (replacement === 'signed') {
    const bundle = path.join(root, 'bundle')
    fs.cpSync(directory, bundle, { recursive: true })
    const keys = crypto.generateKeyPairSync('ed25519')
    const write = async version => {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')))
      fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({ ...manifest, version }))
      const entry = fs.readFileSync(path.join(directory, 'entry.cjs'), 'utf8')
      // A non-enumerable test marker identifies executed revision bytes.
      fs.writeFileSync(path.join(bundle, 'entry.cjs'), `${entry}\nconst originalCreate = exports.create\nexports.create = context => {\n  const instance = originalCreate(context)\n  Object.defineProperty(instance.ports['odk:source/quota/v1'], 'fixtureRevision', { value: ${JSON.stringify(version)} })\n  return instance\n}\n`)
      const files = ['entry.cjs', 'manifest.json'].map(name => ({ path: name,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(bundle, name))).digest('hex') }))
      const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
      const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
      fs.writeFileSync(path.join(bundle, 'bundle.json'), JSON.stringify({ ...payload, signature }))
    }
    await write('2.0.0')
    const keyring = path.join(root, 'publishers.json')
    fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
      publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: [id], hosts: ['electron-main'],
    } } }))
    env.OPEN_DESKOS_NATIVE_KEYRING = keyring
    const authorization = ['--keyring', keyring, '--trust', '--grant', 'source.quota', '--grant', 'ipc']
    const command = args => run(process.execPath, [cli, 'native', ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
    const installed = JSON.parse((await command(['install', bundle, ...authorization])).stdout)
    assert.equal(installed.effect, 'selection-only')
    const config = readConfig(resolveConfigPath(env))
    replacements = await loadNativePlugins(config, { env })
    assert.equal(replacements.length, 1)
    const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
    const stored = await store.read(config.plugins[id].native.revision)
    if (mutateCaptured) fs.writeFileSync(stored.entry, 'throw Error("stored entry changed after discovery")')
    native = { write, bundle, keyring, store, command, authorization,
      selected: () => readConfig(resolveConfigPath(env)).plugins[id] }
  } else if (replacement) {
    await run(process.execPath, [cli, 'link', directory, '--trust', '--replace', '--grant', 'source.quota', '--grant', 'ipc'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
    replacements = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
    assert.equal(replacements.length, 1)
    assert.equal(replacements[0].manifest.version, '2.0.0')
  }
  const handlers = new Map()
  let host
  const start = async selected => {
    host = createPluginHost({ capabilities: {
      ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); ipc?.handle(name, handler); handlers.set(name, handler) }, removeHandler(name) { ipc?.removeHandler(name); handlers.delete(name) } },
      'source.quota': { read },
      'desk.data': { create: createShellDeskData, smokeMode: true },
    } })
    createMainPlugins({ replacementPlugins: selected }).filter(plugin => [id, 'odk.system.desk-data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
    await host.start()
  }
  t.after(() => host.stop())
  await start(replacements)
  return { get host() { return host }, handlers, env, native,
    async reload() {
      await host.stop()
      assert.equal(handlers.size, 0)
      assert.equal(host.list().some(plugin => ['cleanup-failed', 'cleanup-blocked'].includes(plugin.state)), false)
      const config = readConfig(resolveConfigPath(env))
      const selected = native ? await loadNativePlugins(config, { env }) : loadDevelopmentPlugins(config)
      await start(selected)
    },
    ipc: () => handlers.get(channel)(null),
    read: () => host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.page.quota' }),
  }
}


module.exports = { fixture, directory, id, channel }
