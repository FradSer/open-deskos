'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function fixture({ pendingListener = false, closeFailures = 0, routeFailures = 0, pendingClose = false, handlerFailures = 0, realStoreConsumers = false } = {}) {
  const handlers = new Map()
  const routes = new Map()
  const cleanups = []
  const removals = new Map()
  let closed = 0
  let release
  let waiting = false
  let stopping = false
  let unhandled = 0, storesCreated = 0, verifiersCreated = 0
  let releaseClose
  const closeGate = pendingClose ? new Promise(resolve => { releaseClose = resolve }) : Promise.resolve()
  const gate = pendingListener ? new Promise(resolve => { release = resolve }) : Promise.resolve()
  const host = { stateDir: '/fixture', platform: 'linux', provisionsUserAppControl: true, endpoint: () => '/fixture/control.sock' }
  const store = { list: async () => [], getContent: async () => ({ ok: false }) }
  const modules = {
    './user-app-api': require('../src/user-app-api'),
    './native-renderer-assets': require('../src/native-renderer-assets'),
    './user-app-store': { createUserAppStore: () => { storesCreated++; return store } },
    './user-app-verifier': { createUserAppVerifier: () => { verifiersCreated++; return { verify: () => true, close: async () => {} } } },
    './user-app-control': { createUserAppControl: realStoreConsumers ? require('../src/user-app-control').createUserAppControl : () => ({ dispatch: () => ({ ok: true }) }), listenUserAppControl: async () => { waiting = true; await gate; return { close: async () => {
      closed++
      await closeGate
      if (closed <= closeFailures) throw Error('listener close failed')
    } } } },
    './user-app-protocol': { createUserAppResponse: realStoreConsumers ? (_url, selected) => selected.getContent('chosen') : () => ({}) },
    './user-app-content': { buildUserAppDocument() {}, USER_APP_CSP: '' },
    './platform': { resolveShellHost: () => host },
    './local-channel': { readOrCreateToken: async () => 'fixture-token' },
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync('src/user-app-system.js', 'utf8'), { module, require: id => modules[id] || require(id), process: { env: {}, execPath: '/fixture/electron' }, console })
  const start = (options = {}) => module.exports.startUserAppSystem({ app: { once() {} }, ipcMain: { handle: (id, handler) => handlers.set(id, handler), removeHandler: id => {
    removals.set(id, (removals.get(id) || 0) + 1)
    if (id === 'odk-user-apps-publish' && removals.get(id) <= handlerFailures) throw Error('handler release failed')
    handlers.delete(id)
  } }, protocol: { handle: (id, handler) => routes.set(id, handler), unhandle: id => {
    if (++unhandled <= routeFailures) throw Error('protocol release failed')
    routes.delete(id)
  } }, BrowserWindow: { getAllWindows: () => [] }, isStopping: () => stopping, onCleanup: fn => cleanups.push(fn), ...options })
  return { start, handlers, routes, cleanups, removals, storesCreated: () => storesCreated, verifiersCreated: () => verifiersCreated, closed: () => closed, unhandled: () => unhandled,
    waiting: () => waiting, cancel: () => { stopping = true }, release: () => release?.(), releaseClose: () => releaseClose?.() }
}

test('installed package runtime releases IPC, protocol and listener through its owner', async () => {
  const f = fixture()
  await f.start()
  assert.equal(f.handlers.size, 5)
  assert.equal(f.routes.size, 1)
  assert.equal(f.cleanups.length, 1)
  await f.cleanups[0]()
  await f.cleanups[0]()
  assert.equal(f.handlers.size, 0)
  assert.equal(f.routes.size, 0)
  assert.equal(f.closed(), 1)
})

test('a cancelled package runtime closes a listener that finishes startup later', async () => {
  const f = fixture({ pendingListener: true })
  const starting = f.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.waiting(), true)
  assert.equal(f.cleanups.length, 1)
  f.cancel()
  const cleaning = f.cleanups[0]()
  let finished = false
  void cleaning.then(() => { finished = true })
  await new Promise(setImmediate)
  assert.equal(finished, false)
  f.release()
  await starting
  await cleaning
  assert.equal(f.closed(), 1)
  assert.equal(f.handlers.size, 0)
  assert.equal(f.routes.size, 0)
})

test('failed IPC removal remains owned while successful handlers release only once', async () => {
  const f = fixture({ handlerFailures: 1 })
  await f.start()
  await assert.rejects(f.cleanups[0](), /cleanup failed/)
  assert.deepEqual([...f.handlers.keys()], ['odk-user-apps-publish'])
  await f.cleanups[0]()
  assert.equal(f.handlers.size, 0)
  assert.equal(f.removals.get('odk-user-apps-publish'), 2)
  assert.equal(f.removals.get('odk-user-apps-list'), 1)
  assert.equal(f.removals.get('odk-user-apps-dispatch'), 1)
  assert.equal(f.closed(), 1)
})

test('runtime cleanup retries failed listeners and protocol routes without replaying successful release', async () => {
  const f = fixture({ closeFailures: 1, routeFailures: 1 })
  await f.start()
  await assert.rejects(f.cleanups[0](), /cleanup failed/)
  assert.equal(f.handlers.size, 0)
  assert.equal(f.routes.size, 1)
  await f.cleanups[0]()
  assert.equal(f.closed(), 2)
  assert.equal(f.unhandled(), 2)
  assert.equal(f.routes.size, 0)
  await f.cleanups[0]()
  assert.equal(f.closed(), 2)
  assert.equal(f.unhandled(), 2)
})

test('concurrent cleanup calls drain one listener close operation', async () => {
  const f = fixture({ pendingClose: true })
  await f.start()
  const first = f.cleanups[0]()
  const second = f.cleanups[0]()
  let finished = false
  void second.then(() => { finished = true })
  await new Promise(setImmediate)
  assert.equal(f.closed(), 1)
  assert.equal(finished, false)
  f.releaseClose()
  await Promise.all([first, second])
})

test('cancelled startup retains a late listener whose first close fails', async () => {
  const f = fixture({ pendingListener: true, closeFailures: 1 })
  const starting = f.start()
  await new Promise(setImmediate)
  f.cancel()
  f.release()
  await assert.rejects(starting, /cleanup failed/)
  await f.cleanups[0]()
  assert.equal(f.closed(), 2)
})

test('Plugin Host retains installed-runtime dependencies until cleanup retry succeeds', async () => {
  const { createPluginHost } = require('../src/plugin-host')
  const { createDeskRuntimePlugins, DESK_PORTS } = require('../src/plugins/desk-runtime')
  const f = fixture({ closeFailures: 1 })
  const host = createPluginHost({ capabilities: { 'desk.user-apps': {
    start: options => f.start(options), options: {}, smokeMode: false, isStopping: () => false,
  } } })
  let released = 0
  host.register({ manifest: { schemaVersion: 1, id: 'odk.test.catalog', name: 'Catalog', version: '1.0.0', kind: 'service', host: 'electron-main',
    provides: [{ interface: DESK_PORTS.catalog }], requires: [], permissions: [] },
  create: () => ({ ports: { [DESK_PORTS.catalog]: { list: async () => [] } } }) })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.test.data', name: 'Data', version: '1.0.0', kind: 'service', host: 'electron-main',
    provides: [{ interface: DESK_PORTS.data }], requires: [], permissions: [] }, create() {
    return { ports: { [DESK_PORTS.data]: { async syncPackages() {} } }, stop() { released++ } }
  } })
  host.register(createDeskRuntimePlugins().find(plugin => plugin.manifest.id === 'odk.system.user-apps'))
  await host.start()
  assert.equal(f.storesCreated(), 0)
  assert.equal(f.verifiersCreated(), 0)
  await host.stop()
  assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.system.user-apps').state, 'cleanup-failed')
  assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.test.data').state, 'cleanup-blocked')
  assert.equal(released, 0)
  await assert.rejects(host.start(), /still owns resources/)
  await host.stop()
  assert.equal(f.closed(), 2)
  assert.equal(released, 1)
  await host.start()
  await host.stop()
  assert.equal(f.closed(), 3)
})

test('installed runtime uses an injected catalog for public consumers without default reconstruction', async () => {
  const f = fixture({ realStoreConsumers: true })
  const apps = [{ id: 'chosen', revision: 'selected' }]
  let removed = 0
  const store = {
    async list() { return apps },
    async remove(id) { assert.equal(id, 'chosen'); removed++; return { ok: true } },
    async getContent(id) { assert.equal(id, 'chosen'); return { ok: true, html: 'Selected content' } },
  }
  await f.start({ store })
  try {
    const listed = await f.handlers.get('odk-user-apps-list')()
    assert.equal(listed.apps, apps)
    assert.equal((await f.handlers.get('odk-user-apps-dispatch')(null, { command: 'remove', appId: 'chosen' })).ok, true)
    assert.equal(removed, 1)
    assert.equal((await f.routes.get('odk-user-app')({ url: 'odk-user-app://app/chosen/selected' })).html, 'Selected content')
    assert.equal(f.storesCreated(), 0)
    assert.equal(f.verifiersCreated(), 0)
  } finally { await f.cleanups[0]() }
})

test('runtime release waits for selected catalog verification without closing its owner', async () => {
  const f = fixture()
  let release, finished = false, waits = 0
  const gate = new Promise(resolve => { release = resolve })
  const store = { waitForVerification() { waits++; return gate } }
  await f.start({ store })
  const cleaning = f.cleanups[0]().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  const finishedEarly = finished
  release()
  await cleaning
  assert.equal(finishedEarly, false)
  assert.equal(waits, 1)
  assert.equal(f.verifiersCreated(), 0)
})
