'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createPluginHost } = require('../../src/plugin-host')
const { createShellOdkData } = require('../../src/odk-data')
const { listenOdkData } = require('../../src/odk-data-control')
const net = require('node:net')
const { readOrCreateToken, tokenFile } = require('../../src/local-channel')
const { once } = require('node:events')
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')
const { loadNativePlugins } = require('../../src/native-plugin-loader')
const { readConfig } = require('../../src/plugin-config')
const { createNativePluginStore } = require('../../src/native-plugin-store')
const { readNativeKeyring } = require('../../src/native-plugin-policy')
const { resolveShellHost } = require('../../src/platform')
const ID = 'odk.system.data'

async function selection(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-ddr-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bundle = path.join(root, 'bundle')
  await fs.mkdir(bundle)
  for (const name of ['entry.cjs', 'manifest.json']) await fs.copyFile(path.join(__dirname, '../fixtures/odk-data-replacement', name), path.join(bundle, name))
  const modules = ['odk-data.js', 'odk-data-registry.js', 'odk-data-control.js', 'local-channel.js', 'plugins/desk-readings.js', 'plugins/health.js', ...(await fs.readdir(path.join(__dirname, '../../src/plugins/readings'))).filter(name => name.endsWith('.js')).map(name => `plugins/readings/${name}`)].sort()
  for (const name of modules) {
    await fs.mkdir(path.dirname(path.join(bundle, name)), { recursive: true })
    await fs.copyFile(path.join(__dirname, '../../src', name), path.join(bundle, name))
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
  const installed = JSON.parse((await invoke(['install', bundle, '--keyring', keyring, '--trust', '--grant', 'desk.data'])).stdout)
  assert.equal(installed.effect, 'selection-only')
  const config = () => readConfig(path.join(env.ODK_CONFIG_DIR, 'plugins.json'))
  const store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'), keyring: await readNativeKeyring(keyring) })
  const stored = await store.read(config().plugins[ID].native.revision)
  return { root, env, stored, invoke, load: options => loadNativePlugins(config(), { env, ...options }) }
}

async function runtime(t, replacements = [], { link = false, extraRead = async () => ({ state: 'live', value: { count: 3 } }) } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-ddr-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const windows = process.platform === 'win32'
  const endpoint = windows ? '\\\\.\\pipe\\odk-data-test-' + crypto.randomUUID() : path.join(root, 'data.sock')
  const channelToken = link && windows ? await readOrCreateToken({ stateDir: root }) : ''
  const clientEnv = { ODK_DATA_SOCKET: endpoint, ODK_CHANNEL_TOKEN_FILE: tokenFile(root) }
  let installed = [
    { id: 'timer', name: 'Timer', revision: 'r1', data: { fields: { remaining_seconds: { type: 'number' } } } },
    { id: 'portfolio', name: 'Portfolio', revision: 'r1', service: { id: 'futu-poller', endpoint: 'fixture' } },
  ]
  let unavailable = false
  let gate
  let weatherGeneration = 0
  let weatherState = 'live'
  let creates = 0
  let opening
  let defaultLinkStarts = 0
  const updates = []
  const handlers = new Map()
  const extension = { manifest: { schemaVersion: 1, id: 'odk.test.extra', name: 'Extra readings', version: '1.0.0', kind: 'service', host: 'electron-main',
    provides: [{ interface: 'odk:desk-reading/extra/v1' }, { interface: 'odk:desk-service-readings/extra/v1' }], requires: [], permissions: [] },
    create() { return { ports: {
      'odk:desk-reading/extra/v1': [{ id: 'extra.source', label: 'Extra source', kind: 'tile', read: extraRead }],
      'odk:desk-service-readings/extra/v1': { readings: () => [{ id: 'extra.service', label: 'Extra service', kind: 'service', read: async () => ({ state: 'unavailable', value: null }) }] },
    } } },
  }
  const composition = createMainPlugins({ replacementPlugins: replacements, developmentPlugins: [extension] })
  const keep = new Set([ID, 'odk.test.extra', 'odk.system.package-catalog', 'odk.source.weather', 'odk.service.futu', ...(link ? ['odk.transport.data'] : [])])
  const host = createPluginHost({ disabled: composition.filter(plugin => !keep.has(plugin.manifest.id)).map(plugin => plugin.manifest.id), capabilities: {
    ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
    'desk.catalog': { create: () => ({ async list() {
      if (unavailable) throw Error('fixture catalog unavailable')
      if (gate) { const pending = gate; gate = null; pending.enter(); await pending.promise; return pending.entries }
      return installed
    } }) },
    'source.weather': { options: {}, create() {
      const temperature = 20 + ++weatherGeneration
      return { refresh: async () => ({ status: weatherState, current: { temperature }, updatedAt: 1700000000000 }), stop() {} }
    } },
    'desk.futu': { env: {}, options: {}, report() {}, create: () => ({
      snapshot: () => ({ state: 'live', snapshot: { totals: { plRatio: 0.0123 }, positions: [] }, updatedAt: 1700000000000 }),
      async refreshServices() {}, async stop() {},
    }) },
    'desk.data': { smokeMode: false, onUpdate: id => updates.push(id), create(options) {
      creates++
      assert.equal(replacements.some(plugin => plugin.manifest.id === ID), false, 'signed factory must own registry construction')
      return createShellOdkData(options)
    } },
    'desk.link': { enabled: true, smokeMode: false, options: { endpoint, channelToken, stateDir: root }, report(error) { throw Error(error) },
      listen(options) { defaultLinkStarts++; opening = listenOdkData(options); return opening } },
  } })
  composition.forEach(plugin => host.register(plugin))
  t.after(() => host.stop())
  await host.start()
  assert.equal(host.list().find(plugin => plugin.manifest.id === ID).state, 'running')
  await host.get(DESK_PORTS.futu).refresh()
  host.get(DESK_PORTS.data).syncServices()
  let requestId = 0
  return { root, host, updates, handlers, endpoint, clientEnv, creates: () => creates, defaultLinkStarts: () => defaultLinkStarts, data: () => host.get(DESK_PORTS.data),
    catalog: value => { installed = value }, catalogUnavailable: value => { unavailable = value },
    weatherState: value => { weatherState = value },
    revision: value => { installed = installed.map(entry => entry.id === 'timer' ? { ...entry, revision: value } : entry) },
    holdCatalog() {
      let release
      let enter
      const promise = new Promise(resolve => { release = resolve })
      const entered = new Promise(resolve => { enter = resolve })
      gate = { promise, enter, entries: installed }
      t.after(release)
      return { entered, release }
    },
    async assertLinkClosed() {
      if (!windows) await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' })
      const socket = net.createConnection(endpoint)
      try { await assert.rejects(once(socket, 'connect'), error => ['ENOENT', 'ECONNREFUSED'].includes(error.code)) }
      finally { socket.destroy() }
    },
    async request(payload) {
      await opening
      const socket = net.createConnection(endpoint)
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
        socket.on('close', () => reject(Error('Open DeskOS Data response closed before completion')))
      })
      if (windows) socket.write(`${JSON.stringify({ v: 1, token: channelToken })}\n`)
      socket.write(`${JSON.stringify({ v: 1, id: `fixture-${++requestId}`, ...payload })}\n`)
      try { return await response } finally { socket.destroy() }
    },
  }
}

module.exports = { selection, runtime, ID }
