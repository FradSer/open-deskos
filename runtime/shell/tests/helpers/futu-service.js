'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const net = require('node:net')
const { once } = require('node:events')
const { promisify } = require('node:util')
const execFile = promisify(require('node:child_process').execFile)
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createPluginHost } = require('../../src/plugin-host')
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')
const { createFutuSource } = require('../../src/futu-source')
const { createShellOdkData } = require('../../src/odk-data')
const { readConfig } = require('../../src/plugin-config')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { resolveShellHost } = require('../../src/platform')

const ID = 'odk.service.futu'
const cli = path.resolve(__dirname, '../../scripts/odk-plugin-cli.js')

async function signedSelection(root) {
  const bundle = path.join(root, 'bundle')
  await fs.mkdir(path.join(bundle, 'readings'), { recursive: true })
  for (const name of ['manifest.json', 'entry.cjs']) await fs.copyFile(path.join(__dirname, '../fixtures/futu-service-replacement', name), path.join(bundle, name))
  for (const name of ['futu', 'common']) await fs.copyFile(path.join(__dirname, '../../src/plugins/readings', `${name}.js`), path.join(bundle, 'readings', `${name}.js`))
  await fs.copyFile(path.join(__dirname, '../../src/plugins/health.js'), path.join(bundle, 'health.js'))
  const keys = crypto.generateKeyPairSync('ed25519')
  const files = await Promise.all(['entry.cjs', 'health.js', 'manifest.json', 'readings/common.js', 'readings/futu.js'].map(async name => ({
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
  const invoke = args => execFile(process.execPath, [cli, 'native', ...args], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } })
  const installed = JSON.parse((await invoke(['install', bundle, '--keyring', keyring, '--trust', '--grant', 'desk.futu', '--grant', 'ipc'])).stdout)
  assert.equal(installed.effect, 'selection-only')
  const config = () => readConfig(path.join(env.ODK_CONFIG_DIR, 'plugins.json'))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  return { env, config, store, invoke, load: () => loadNativePlugins(config(), { env }) }
}

async function fixture(t, signed, { replacementPlugins } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-fsr-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const selection = signed ? await signedSelection(root) : null
  const endpoint = path.join(root, 'publisher.sock')
  let installed = [{ id: 'finance', name: 'Portfolio', revision: 'r1', service: { id: 'futu-poller', endpoint } }]
  let hold
  let held
  const handlers = new Map()
  const sources = []
  let now = 1700000000000
  const keep = new Set(['odk.system.package-catalog', ID, 'odk.system.data'])
  const composition = createMainPlugins({ replacementPlugins: replacementPlugins ?? (selection ? await selection.load() : []) })
  let capturedRoot
  if (selection) {
    const stored = await selection.store.read(selection.config().plugins[ID].native.revision)
    capturedRoot = stored.root
    await fs.writeFile(stored.entry, 'throw Error("mutated stored entry")')
    await fs.writeFile(path.join(stored.root, 'readings/futu.js'), 'throw Error("mutated stored projection")')
  }
  const host = createPluginHost({ disabled: composition.filter(plugin => !keep.has(plugin.manifest.id)).map(plugin => plugin.manifest.id), capabilities: {
    ipc: { handle(channel, callback) { assert.equal(handlers.has(channel), false); handlers.set(channel, callback) }, removeHandler: channel => handlers.delete(channel) },
    'desk.catalog': { create: () => ({ async list() { if (hold) { held(); await hold }; return installed } }) },
    'desk.futu': { env: {}, report() {}, options: { runtimeDir: root, now: () => now },
      create(options) { const source = createFutuSource(options); sources.push(source); return source } },
    'desk.data': { create: createShellOdkData, smokeMode: true },
  } })
  composition.forEach(plugin => host.register(plugin))
  t.after(() => host.stop())
  await host.start()
  const refresh = async () => { await host.get(DESK_PORTS.futu).refresh(); host.get(DESK_PORTS.data).syncServices() }
  await refresh()
  return { root, endpoint, host, selection, capturedRoot, handlers, sources, refresh, now: () => now, advance: value => { now += value },
    declarations: value => { installed = value },
    holdCatalog() {
      let release
      hold = new Promise(resolve => { release = resolve })
      const entered = new Promise(resolve => { held = resolve })
      return { entered, release() { hold = null; release() } }
    },
    read: () => host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'futu-poller' }),
    health: () => host.get(DESK_PORTS.futuHealth).snapshot(),
  }
}

async function publisher(t, endpoint, revision = 'r1') {
  const socket = net.createConnection(endpoint)
  t.after(() => socket.destroy())
  const acknowledgements = []
  let pending
  let buffer = ''
  socket.on('data', bytes => {
    buffer += bytes.toString()
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const record = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (record.type !== 'ack') continue
      if (pending) { const { resolve } = pending; pending = null; resolve(record) } else acknowledgements.push(record)
    }
  })
  const rejectPending = error => { if (pending) { const { reject } = pending; pending = null; reject(error) } }
  socket.on('error', rejectPending)
  socket.on('close', () => rejectPending(Error('publisher connection closed')))
  await once(socket, 'connect')
  const send = record => {
    const result = acknowledgements.length ? Promise.resolve(acknowledgements.shift()) : new Promise((resolve, reject) => { pending = { resolve, reject } })
    socket.write(`${JSON.stringify({ v: 1, service: 'futu-poller', ...record })}\n`)
    return result
  }
  assert.equal((await send({ type: 'hello', revision, proto: 1 })).ok, true)
  return { socket, send }
}

module.exports = { signedSelection, fixture, publisher }
