'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createPluginHost } = require('../../src/plugin-host')
const { startUserAppSystem, resolveUserAppSurface } = require('../../src/user-app-system')
const { createUserAppStore } = require('../../src/user-app-store')
const { createShellOdkData } = require('../../src/odk-data')
const { USER_APP_CSP } = require('../../src/user-app-content')
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')
const net = require('node:net')
const { once } = require('node:events')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { readConfig } = require('../../src/plugin-config')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { resolveShellHost } = require('../../src/platform')
const ID = 'odk.system.user-apps'

async function runtimeFiles() {
  const root = path.resolve(__dirname, '../../')
  const files = new Set()
  async function visit(name) {
    if (files.has(name)) return
    files.add(name)
    const source = await fs.readFile(path.join(root, name), 'utf8')
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const target = path.resolve(root, path.dirname(name), match[1])
      const candidates = [target, `${target}.js`, path.join(target, 'index.js')]
      let found
      for (const candidate of candidates) {
        if (await fs.stat(candidate).then(stat => stat.isFile(), () => false)) { found = candidate; break }
      }
      assert.ok(found, `missing runtime module ${match[1]}`)
      await visit(path.relative(root, found))
    }
  }
  await visit('src/user-app-system.js')
  await visit('src/user-app-verifier-runner.js')
  for (const name of ['src/renderer/config/desktop_layout.js', 'src/renderer/fonts/zpix.woff2',
    'src/renderer/fonts/Montserrat-Bold.ttf', 'src/renderer/fonts/NotoSansSC-Regular.ttf']) files.add(name)
  return [...files].sort()
}

async function selection(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-uar-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bundle = path.join(root, 'bundle')
  await fs.mkdir(bundle)
  for (const name of ['entry.cjs', 'manifest.json']) await fs.copyFile(path.join(__dirname, '../fixtures/user-app-system-replacement', name), path.join(bundle, name))
  const modules = await runtimeFiles()
  for (const name of modules) {
    await fs.mkdir(path.dirname(path.join(bundle, name)), { recursive: true })
    await fs.copyFile(path.join(__dirname, '../../', name), path.join(bundle, name))
  }
  const keys = crypto.generateKeyPairSync('ed25519')
  const files = await Promise.all(['entry.cjs', 'manifest.json', ...modules].sort().map(async name => ({
    path: name, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(bundle, name))).digest('hex'),
  })))
  const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
  const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
  await fs.writeFile(path.join(bundle, 'bundle.json'), JSON.stringify({ ...payload, signature }))
  const keyring = path.join(root, 'publishers.json')
  await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: [ID], hosts: ['electron-main'],
  } } }))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), ODK_NATIVE_KEYRING: keyring }
  const invoke = args => execFile(process.execPath, [path.resolve(__dirname, '../../scripts/odk-plugin-cli.js'), 'native', ...args],
    { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
  const installed = JSON.parse((await invoke(['install', bundle, '--keyring', keyring, '--trust', '--grant', 'desk.user-apps'])).stdout)
  assert.equal(installed.effect, 'selection-only')
  const config = () => readConfig(path.join(env.ODK_CONFIG_DIR, 'plugins.json'))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(config().plugins[ID].native.revision)
  return { root, env, stored, invoke, load: options => loadNativePlugins(config(), { env, ...options }) }
}

async function runtime(t, plugins = [], { ui, verify = () => true, html = '<p id="value">Counter</p>', releaseFailures = 0, catalog = null, initialSync } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-uar-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const env = { ...process.env, XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
    XDG_RUNTIME_DIR: path.join(root, 'runtime'), ODK_WORKSPACE: path.join(root, 'workspace') }
  const surface = resolveUserAppSurface({ env })
  await fs.mkdir(path.dirname(surface.controlEndpoint), { recursive: true, mode: 0o700 })
  const draft = path.join(env.ODK_WORKSPACE, 'apps/counter')
  await fs.mkdir(draft, { recursive: true })
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'counter', name: 'Counter', version: '1', kind: 'app', data: { fields: { count: { type: 'number' } } } }))
  await fs.writeFile(path.join(draft, 'index.html'), html)
  // This host check seeds a fixture revision. Electron verification has its own
  // gate; no production installation or document verifier claim is made here.
  const store = createUserAppStore({ workspace: env.ODK_WORKSPACE, stateDir: surface.stateDir, verify })
  assert.equal((await store.install('counter')).ok, true)
  const publications = new Set()
  const data = createShellOdkData({ store: catalog || store, readings: [], serviceReadings: () => [], onUpdate: id => {
    for (const listener of [...publications]) listener(id)
  } })
  await data.syncPackages()
  if (initialSync) data.syncPackages = initialSync
  const handlers = new Map()
  const routes = new Map()
  const changes = []
  let starts = 0
  const dataPlugin = { manifest: { schemaVersion: 1, id: 'odk.system.data', name: 'Fixture Open DeskOS Data', version: '1.0.0', kind: 'service', host: 'electron-main',
    provides: [{ interface: DESK_PORTS.data }], requires: [], permissions: [] }, create: () => ({ ports: { [DESK_PORTS.data]: data } }) }
  const catalogPlugin = { manifest: { schemaVersion: 1, id: 'odk.system.package-catalog', name: 'Selected fixture catalog',
    version: '2.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: DESK_PORTS.catalog }], requires: [], permissions: [] },
    create: () => ({ ports: { [DESK_PORTS.catalog]: catalog || store } }) }
  const composition = createMainPlugins({ replacementPlugins: [...plugins, dataPlugin, catalogPlugin] })
  const keep = new Set([ID, dataPlugin.manifest.id, catalogPlugin.manifest.id])
  const host = createPluginHost({ disabled: composition.filter(plugin => !keep.has(plugin.manifest.id)).map(plugin => plugin.manifest.id), capabilities: {
    'desk.user-apps': { smokeMode: false, isStopping: () => false, options: { env,
      app: ui?.app || { once() {} }, BrowserWindow: ui?.BrowserWindow || { getAllWindows: () => [{ webContents: { send: name => changes.push(name) } }] },
      ipcMain: { handle(name, handler) { assert.equal(handlers.has(name), false); ui?.ipcMain.handle(name, handler); handlers.set(name, handler) },
        removeHandler(name) { ui?.ipcMain.removeHandler(name); handlers.delete(name) } },
      protocol: { handle(name, handler) { assert.equal(routes.has(name), false); ui?.protocol.handle(name, handler); routes.set(name, handler) },
        unhandle(name) {
          if (releaseFailures > 0) { releaseFailures--; throw Error('fixture protocol release failed') }
          ui?.protocol.unhandle(name); routes.delete(name)
        } },
    }, start(options) {
      starts++
      assert.equal(plugins.length, 0, 'signed factory must own runtime startup')
      return startUserAppSystem(options)
    } },
  } })
  composition.forEach(plugin => host.register(plugin))
  t.after(() => host.stop())
  await host.start()
  assert.equal(host.list().find(plugin => plugin.manifest.id === ID).state, 'running')
  let sequence = 0
  return { root, env, surface, host, handlers, routes, changes, store, data, policy: USER_APP_CSP, starts: () => starts, endpoint: surface.controlEndpoint,
    published() {
      return new Promise(resolve => {
        const listener = id => { publications.delete(listener); resolve(id) }
        publications.add(listener)
        t.after(() => publications.delete(listener))
      })
    },
    async request(payload) {
      const socket = net.createConnection(surface.controlEndpoint)
      t.after(() => socket.destroy())
      await once(socket, 'connect')
      const response = new Promise((resolve, reject) => {
        let buffer = ''
        socket.on('error', reject)
        socket.on('data', bytes => {
          buffer += bytes.toString()
          if (!buffer.includes('\n')) return
          try { resolve(JSON.parse(buffer.trim())) } catch (error) { reject(error) }
        })
        socket.on('close', () => reject(Error('Package response closed before completion')))
      })
      socket.write(`${JSON.stringify({ v: 1, id: `fixture-${++sequence}`, ...payload })}\n`)
      try { return await response } finally { socket.destroy() }
    },
  }
}

module.exports = { selection, runtime, ID }
