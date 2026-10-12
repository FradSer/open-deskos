'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createPluginHost } = require('../../src/plugin-host')
const { createAppManagerEndpoint } = require('../../src/app-manager-endpoint')
const { loadDevelopmentPlugins } = require('../../src/development-plugins')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { readConfig } = require('../../src/plugin-config')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { resolveShellHost } = require('../../src/platform')
const { SYSTEM_PORTS } = require('../../src/plugins/system-channels')
const ID = 'odk.system.app-manager'
const CHANNELS = ['odk-app-manager-list', 'odk-app-manager-state', 'odk-app-manager-intent']

async function selection(t, { mode = 'signed', transformManager, parentDir = os.tmpdir() } = {}) {
  const root = await fs.mkdtemp(path.join(parentDir, 'odk-amr-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bundle = path.join(root, 'bundle')
  await fs.mkdir(bundle)
  for (const name of ['catalog.json', 'entry.cjs', 'manager.js', 'manifest.json']) await fs.copyFile(path.join(__dirname, '../fixtures/app-manager-replacement', name), path.join(bundle, name))
  if (transformManager) {
    const file = path.join(bundle, 'manager.js')
    await fs.writeFile(file, transformManager(await fs.readFile(file, 'utf8')))
  }
  if (mode === 'development') {
    const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
      LOCALAPPDATA: path.join(root, 'state') }
    const invoke = args => execFile(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), ...args],
      { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
    await invoke(['link', bundle, '--trust', '--replace', '--grant', 'ipc', '--grant', 'system.app-manager'])
    const config = () => readConfig(path.join(env.OPEN_DESKOS_CONFIG_DIR, 'plugins.json'))
    return { root, env, invoke, load: options => loadDevelopmentPlugins(config(), options) }
  }
  const keys = crypto.generateKeyPairSync('ed25519')
  const files = await Promise.all(['catalog.json', 'entry.cjs', 'manager.js', 'manifest.json'].map(async name => ({
    path: name, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(bundle, name))).digest('hex'),
  })))
  const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
  const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
  await fs.writeFile(path.join(bundle, 'bundle.json'), JSON.stringify({ ...payload, signature }))
  const keyring = path.join(root, 'publishers.json')
  await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: [ID], hosts: ['electron-main'],
  } } }))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), OPEN_DESKOS_NATIVE_KEYRING: keyring }
  const invoke = args => execFile(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), 'native', ...args],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
  const installed = JSON.parse((await invoke(['install', bundle, '--keyring', keyring, '--trust', '--grant', 'ipc', '--grant', 'system.app-manager'])).stdout)
  assert.equal(installed.effect, 'selection-only')
  const config = () => readConfig(path.join(env.OPEN_DESKOS_CONFIG_DIR, 'plugins.json'))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(config().plugins[ID].native.revision)
  return { root, env, stored, invoke, load: options => loadNativePlugins(config(), { env, ...options }) }
}

async function runtime(t, replacements = [], { ipc } = {}) {
  const handlers = new Map()
  const composition = createMainPlugins({ replacementPlugins: replacements })
  let creates = 0
  const host = createPluginHost({ disabled: composition.filter(plugin => plugin.manifest.id !== ID).map(plugin => plugin.manifest.id), capabilities: {
    ipc: {
      handle(name, callback) {
        assert.equal(handlers.has(name), false)
        ipc?.handle(name, callback)
        handlers.set(name, callback)
      },
      removeHandler(name) { ipc?.removeHandler(name); handlers.delete(name) },
    },
    'system.app-manager': { create() {
      creates++
      assert.equal(replacements.length, 0, 'replacement factory must own manager construction')
      return createAppManagerEndpoint()
    } },
  } })
  composition.forEach(plugin => host.register(plugin))
  t.after(() => host.stop())
  await host.start()
  assert.equal(host.list().find(plugin => plugin.manifest.id === ID).state, 'running')
  return { host, handlers, creates: () => creates,
    list: () => handlers.get(CHANNELS[0])(null), get: id => handlers.get(CHANNELS[1])(null, id),
    dispatch: intent => handlers.get(CHANNELS[2])(null, intent),
  }
}

module.exports = { selection, runtime, ID, CHANNELS }
