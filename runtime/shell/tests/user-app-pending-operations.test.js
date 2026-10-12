'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const syncFs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const source = path.join(__dirname, '../src/user-app-system.js')
const actualRequire = createRequire(source)

test('runtime stop retains ownership of an installation waiting for verification', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pending-install-observation-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const workspace = path.join(root, 'workspace')
  const draft = path.join(workspace, 'apps/counter')
  await fs.mkdir(draft, { recursive: true })
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'counter', name: 'Counter', version: '1', kind: 'app' }))
  await fs.writeFile(path.join(draft, 'index.html'), '<body>Counter</body>')
  let releaseVerification, verificationStarted
  const entered = new Promise(resolve => { verificationStarted = resolve })
  const gate = new Promise(resolve => { releaseVerification = resolve })
  const handlers = new Map()
  const cleanups = []
  let notifications = 0
  const overrides = {
    './user-app-verifier': { createUserAppVerifier: () => ({ async verify() { verificationStarted(); await gate; return { ok: true } }, close: async () => {} }) },
    './platform': { resolveShellHost: () => ({ stateDir: path.join(root, 'state'), provisionsUserAppControl: false }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(syncFs.readFileSync(source, 'utf8'), { module, require: id => overrides[id] || actualRequire(id), process, console })
  await module.exports.startUserAppSystem({
    app: { once() {} },
    ipcMain: { handle: (id, callback) => handlers.set(id, callback), removeHandler: id => handlers.delete(id) },
    protocol: { handle() {}, unhandle() {} },
    BrowserWindow: { getAllWindows: () => [{ webContents: { send() { notifications++ } } }] },
    env: { ODESK_WORKSPACE: workspace }, onCleanup: cleanup => cleanups.push(cleanup),
  })
  const installing = handlers.get('odk-user-apps-dispatch')(null, { command: 'install', appId: 'counter' })
  await entered
  let cleaned = false
  const stopping = cleanups[0]().then(() => { cleaned = true })
  await new Promise(setImmediate)
  const cleanedBeforeVerification = cleaned
  releaseVerification()
  const result = await installing
  await stopping
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'state/user-apps/user-apps.json'), 'utf8'))
  assert.equal(result.ok, true)
  assert.equal(catalog.some(entry => entry.id === 'counter'), true)
  assert.equal(cleanedBeforeVerification, false, 'runtime cleanup released ownership before pending installation settled')
  assert.equal(notifications, 0, 'stopping runtime cannot notify released consumers')
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function runtime({ content = () => new Response('Content'), syncPackages = async () => {}, hosted = false,
  startupSync = false, verifierClose = async () => {}, replacement = false } = {}) {
  const handlers = new Map()
  const routes = new Map()
  const cleanups = []
  let control, installs = 0, publishes = 0, notifications = 0, closes = 0, providerReleases = 0
  const overrides = {
    './user-app-store': { createUserAppStore: () => ({
      list: async () => [], install: async () => { installs++; return { ok: true } },
    }) },
    './user-app-verifier': { createUserAppVerifier: () => ({ verify: async () => ({ ok: true }), close: verifierClose }) },
    './user-app-control': { ...actualRequire('./user-app-control'), async listenUserAppControl(options) {
      control = options.control
      return { async close() { closes++ } }
    } },
    './user-app-protocol': { createUserAppResponse: content },
    './platform': { resolveShellHost: () => ({ stateDir: '/fixture', provisionsUserAppControl: true,
      endpoint: () => '/fixture/control.sock', platform: 'linux' }) },
    './local-channel': { readOrCreateToken: async () => 'fixture-token' },
  }
  const module = { exports: {} }
  vm.runInNewContext(syncFs.readFileSync(source, 'utf8'), {
    module, require: id => overrides[id] || actualRequire(id), process, console, Response,
  })
  const options = { app: { once() {} },
    ipcMain: { handle: (id, callback) => handlers.set(id, callback), removeHandler: id => handlers.delete(id) },
    protocol: { handle: (id, callback) => routes.set(id, callback), unhandle: id => routes.delete(id) },
    BrowserWindow: { getAllWindows: () => [{ webContents: { send() { notifications++ } } }] },
    deskData: { registry: { publish() { publishes++; return { ok: true } } }, syncPackages },
    env: {}, onCleanup: cleanup => cleanups.push(cleanup),
  }
  let host
  if (hosted) {
    const { createPluginHost } = actualRequire('./plugin-host')
    const { createDeskRuntimePlugins, DESK_PORTS } = actualRequire('./plugins/desk-runtime')
    host = createPluginHost({ capabilities: { 'desk.user-apps': {
      options, smokeMode: !startupSync, isStopping: () => false,
      start: settings => {
        assert.equal(replacement, false, 'selected factory must not invoke the default starter')
        return module.exports.startUserAppSystem(settings)
      },
    } } })
    const selectedStore = { ...overrides['./user-app-store'].createUserAppStore(), waitForVerification: verifierClose }
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.catalog', name: 'Catalog', version: '1.0.0',
      kind: 'service', host: 'electron-main', provides: [{ interface: DESK_PORTS.catalog }], requires: [], permissions: [] },
    create: () => ({ ports: { [DESK_PORTS.catalog]: selectedStore } }) })
    host.register({ manifest: { schemaVersion: 1, id: 'odk.test.data', name: 'Data', version: '1.0.0',
      kind: 'service', host: 'electron-main', provides: [{ interface: DESK_PORTS.data }], requires: [], permissions: [] },
    create: () => ({ ports: { [DESK_PORTS.data]: options.deskData }, stop() { providerReleases++ } }) })
    let definition = createDeskRuntimePlugins().find(plugin => plugin.manifest.id === 'odk.system.user-apps')
    if (replacement) {
      const entry = path.join(__dirname, 'fixtures/user-app-system-replacement/entry.cjs')
      const exports = {}
      vm.runInNewContext(syncFs.readFileSync(entry, 'utf8'), {
        exports, console,
        require: id => {
          assert.equal(id, './src/user-app-system')
          return module.exports
        },
      })
      definition = { manifest: definition.manifest, create: exports.create }
    }
    host.register(definition)
    await host.start()
  } else await module.exports.startUserAppSystem(options)
  return { handlers, routes, control, host, stop: host ? () => host.stop() : cleanups[0],
    providerReleases: () => providerReleases, counts: () => ({ installs, publishes, notifications, closes }) }
}

test('stopped runtime refuses retained IPC, external control, and content callbacks', async () => {
  const f = await runtime()
  const dispatch = f.handlers.get('odk-user-apps-dispatch')
  const publish = f.handlers.get('odk-user-apps-publish')
  const content = f.routes.get('odk-user-app')
  await f.stop()
  for (const request of [() => dispatch(null, { command: 'install', appId: 'counter' }),
    () => f.control.dispatch({ command: 'install', appId: 'counter' }),
    () => publish(null, { appId: 'counter', data: {} })]) {
    const result = await request()
    assert.equal(result.ok, false)
    assert.equal(result.error, 'application-store-unavailable')
  }
  assert.equal((await content({ url: 'odk-user-app://app/counter/revision' })).status, 503)
  assert.deepEqual(f.counts(), { installs: 0, publishes: 0, notifications: 0, closes: 1 })
})

for (const rejected of [false, true]) {
  test(`runtime release drains accepted content ${rejected ? 'rejection' : 'success'}`, async () => {
    const gate = deferred()
    const f = await runtime({ content: () => gate.promise })
    const request = f.routes.get('odk-user-app')({ url: 'odk-user-app://app/counter/revision' })
    const result = Promise.resolve(request).then(value => ({ value }), error => ({ error }))
    let stopped = false
    const stopping = f.stop().then(() => { stopped = true })
    await new Promise(setImmediate)
    const releasedWhilePending = stopped
    const failure = Error('Controlled content failure')
    if (rejected) gate.reject(failure)
    else gate.resolve(new Response('Content'))
    const outcome = await result
    await stopping
    assert.equal(releasedWhilePending, false)
    if (rejected) assert.equal(outcome.error, failure)
    else assert.equal(await outcome.value.text(), 'Content')
    assert.equal(f.counts().closes, 1)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.routes.size, 0)
  })
}

test('runtime release waits for verifier ownership after installation requests settle', async () => {
  const gate = deferred()
  const entered = deferred()
  const f = await runtime({ verifierClose: () => { entered.resolve(); return gate.promise } })
  let stopped = false
  const stopping = f.stop().then(() => { stopped = true })
  await entered.promise
  const releasedBeforeVerifier = stopped
  const handlersBeforeVerifier = f.handlers.size
  gate.resolve()
  await stopping
  assert.equal(releasedBeforeVerifier, false)
  assert.equal(handlersBeforeVerifier, 3)
  assert.equal(f.handlers.size, 0)
  assert.equal(f.counts().closes, 1)
})

test('failed catalog verification drain retains the production Host provider for cleanup retry', async () => {
  let attempts = 0
  const f = await runtime({ hosted: true, verifierClose: async () => {
    if (++attempts === 1) throw Error('Controlled verifier release failure')
  } })
  await f.stop()
  assert.equal(f.host.list().find(record => record.manifest.id === 'odk.system.user-apps').state, 'cleanup-failed')
  assert.equal(f.providerReleases(), 0)
  assert.equal(f.handlers.size, 3)
  await f.stop()
  assert.equal(attempts, 2)
  assert.equal(f.providerReleases(), 1)
  assert.equal(f.handlers.size, 0)
  assert.equal(f.counts().closes, 1)
})

test('runtime release drains package data synchronization started by an accepted change', async () => {
  const gate = deferred()
  const entered = deferred()
  const f = await runtime({ syncPackages: () => { entered.resolve(); return gate.promise } })
  assert.equal((await f.control.dispatch({ command: 'install', appId: 'counter' })).ok, true)
  await entered.promise
  let stopped = false
  const stopping = f.stop().then(() => { stopped = true })
  await new Promise(setImmediate)
  const releasedWhilePending = stopped
  gate.resolve()
  await stopping
  assert.equal(releasedWhilePending, false)
  assert.equal(f.counts().notifications, 1)
  assert.equal(f.counts().closes, 1)
})

test('production Host retains the data provider until accepted runtime content settles', async () => {
  const gate = deferred()
  const f = await runtime({ content: () => gate.promise, hosted: true })
  const request = f.routes.get('odk-user-app')({ url: 'odk-user-app://app/counter/revision' })
  let stopped = false
  const stopping = f.stop().then(() => { stopped = true })
  await new Promise(setImmediate)
  const releasedWhilePending = stopped
  const providersReleasedWhilePending = f.providerReleases()
  gate.resolve(new Response('Content'))
  await request
  await stopping
  assert.equal(releasedWhilePending, false)
  assert.equal(providersReleasedWhilePending, 0)
  assert.equal(f.providerReleases(), 1)
  assert.ok(f.host.list().every(record => record.state === 'stopped'))
})

for (const replacement of [false, true]) for (const rejected of [false, true]) {
  test(`production Host retains ${replacement ? 'selected' : 'default'} initial data synchronization until ${rejected ? 'rejection' : 'success'}`, async t => {
    const gate = deferred()
    const entered = deferred()
    const errors = t.mock.method(console, 'error', () => {})
    const f = await runtime({ hosted: true, startupSync: true, replacement,
      syncPackages: () => { entered.resolve(); return gate.promise } })
    await entered.promise
    let stopped = false
    const stopping = f.stop().then(() => { stopped = true })
    await new Promise(setImmediate)
    const releasedWhilePending = stopped
    const providersReleasedWhilePending = f.providerReleases()
    if (rejected) gate.reject(Error('Controlled synchronization failure'))
    else gate.resolve()
    await stopping
    assert.equal(releasedWhilePending, false)
    assert.equal(providersReleasedWhilePending, 0)
    assert.equal(f.providerReleases(), 1)
    assert.equal(errors.mock.callCount(), rejected ? 1 : 0)
  })
}
