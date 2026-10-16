'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { createDeskRuntimePlugins, DESK_PORTS } = require('../src/plugins/desk-runtime')

function fixture({ holdSync = false, smokeMode = false } = {}) {
  const handlers = new Map()
  const events = []
  let catalog = []
  let failCatalog = false
  let releaseSync
  const syncGate = holdSync ? new Promise(resolve => { releaseSync = resolve }) : Promise.resolve()
  const store = { list: async () => { if (failCatalog) throw Error('catalog-unavailable'); return catalog } }
  let declarations
  const readings = []
  const timers = new Set()
  const capabilities = {
    ipc: { handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id) },
    'desk.catalog': { create: () => store, options: { stateDir: '/fixture' } },
    'desk.futu': {
      create: options => {
        declarations = options.services
        return { snapshot: id => ({ service: id }), refreshServices: async () => events.push('refresh'), stop: async () => events.push('futu-stop') }
      }, options: { runtimeDir: '/fixture/runtime' }, env: {}, report: error => events.push(error),
    },
    'desk.data': { smokeMode, onUpdate() {}, create: sources => {
      const reading = { sources, syncPackages: async () => { events.push('sync'); await syncGate }, syncServices: () => events.push('services') }
      readings.push(reading)
      return reading
    } },
    'desk.refresh': { smokeMode, setInterval: fn => { timers.add(fn); return { fn, unref() {} } }, clearInterval: handle => timers.delete(handle.fn), report: error => events.push(error) },
    'desk.user-apps': { smokeMode, isStopping: () => false, options: {}, start: async options => {
      events.push('user-apps')
      options.onCleanup(() => events.push('user-apps-stop'))
    } },
    'desk.link': { smokeMode, enabled: false, options: {}, report: error => events.push(error) },
  }
  const host = createPluginHost({ capabilities })
  for (const plugin of createDeskRuntimePlugins()) host.register(plugin)
  return { host, handlers, events, readings, timers, capabilities, store, declarations: () => declarations(), releaseSync: () => releaseSync?.(), catalog: next => { catalog = next }, failCatalog: () => { failCatalog = true } }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('installed runtime cannot restart without its selected catalog', async t => {
  const f = fixture({ smokeMode: true })
  t.after(() => f.host.stop())
  const stores = []
  f.capabilities['desk.user-apps'].start = async options => { stores.push(options.store) }
  await f.host.start()
  assert.deepEqual(stores, [f.store])
  await f.host.setEnabled('odk.system.package-catalog', false)
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.user-apps').state, 'blocked')
  assert.deepEqual(stores, [f.store], 'catalog removal must not start the runtime with a fallback store')
  await f.host.setEnabled('odk.system.package-catalog', true)
  assert.deepEqual(stores, [f.store, f.store])
})

test('failed catalog startup cannot allocate an installed runtime', async t => {
  const f = fixture({ smokeMode: true })
  t.after(() => f.host.stop())
  f.capabilities['desk.catalog'].create = () => { throw Error('Controlled catalog startup failure') }
  await f.host.start()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.user-apps').state, 'blocked')
  assert.equal(f.events.includes('user-apps'), false)
})

test('service declaration refresh preserves duplicate ownership, removals and unreadable catalog', async () => {
  const f = fixture()
  f.catalog([{ id: 'old', name: 'Old', revision: 'r1', service: { id: 'futu-poller', socket: 'old.sock' } }, { id: 'new', name: 'New', revision: 'r2', service: { id: 'futu-poller', endpoint: 'new.sock' } }])
  await f.host.start()
  await settle()
  assert.deepEqual(f.declarations(), { 'futu-poller': { revision: 'r2', endpoint: 'new.sock', label: 'New' } })
  assert.deepEqual(f.handlers.get('odk-futu-holdings')(null, {}), { service: 'futu-poller' })
  assert.deepEqual(f.handlers.get('odk-futu-holdings')(null, { service: 'other' }), { service: 'other' })
  f.failCatalog()
  await f.host.get(DESK_PORTS.futu).refresh()
  assert.equal(f.declarations()['futu-poller'].endpoint, 'new.sock')
  await f.host.stop()
  assert.equal(f.timers.size, 0)
  assert.equal(f.handlers.size, 0)
  assert.equal(f.events.filter(value => value === 'futu-stop').length, 1)
  const removed = fixture()
  removed.catalog([{ id: 'one', revision: 'r1', service: { id: 'one', socket: 'one.sock' } }])
  await removed.host.start()
  await settle()
  removed.catalog([])
  await removed.host.get(DESK_PORTS.futu).refresh()
  assert.deepEqual(removed.declarations(), {})
  await removed.host.stop()
})

test('catalog synchronization precedes refresh and cancellation prevents later allocation', async () => {
  const f = fixture({ holdSync: true })
  const starting = f.host.start()
  await settle()
  assert.deepEqual(f.events, ['sync'])
  assert.equal(f.timers.size, 0)
  const stopping = f.host.stop()
  f.releaseSync()
  await starting
  await stopping
  assert.equal(f.timers.size, 0)
  assert.equal(f.events.includes('refresh'), false)
})

test('Open DeskOS Data restarts against the replacement optional source', async () => {
  const f = fixture()
  let generation = 0
  f.host.register({ manifest: { schemaVersion: 1, id: 'odk.source.weather', name: 'Weather', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: DATA_PORTS.weather }] }, create: () => ({ ports: { [DATA_PORTS.weather]: { generation: ++generation } } }) })
  await f.host.start()
  const first = f.host.get(DESK_PORTS.data)
  assert.equal(first.sources.weather.generation, 1)
  await f.host.setEnabled('odk.source.weather', false)
  assert.equal(f.host.get(DESK_PORTS.data).sources.weather, null)
  await f.host.setEnabled('odk.source.weather', true)
  assert.equal(f.host.get(DESK_PORTS.data).sources.weather.generation, 2)
  assert.notEqual(f.host.get(DESK_PORTS.data), first)
  assert.equal(f.timers.size, 1)
  await f.host.stop()
})

test('smoke composition neither reads installed packages nor starts service refresh', async () => {
  const f = fixture({ smokeMode: true })
  f.store.list = () => { throw Error('smoke must not read catalog') }
  await f.host.start()
  assert.deepEqual(f.events, ['user-apps'])
  assert.equal(f.timers.size, 0)
  await f.host.stop()
})

test('real Open DeskOS Data preserves published package data while rebinding built-in readers', async () => {
  const f = fixture()
  f.capabilities['desk.data'].create = require('../src/odk-data').createShellOdkData
  f.catalog([{ id: 'timer', name: 'Timer', revision: 'r1', data: { fields: { remaining_seconds: { type: 'number' } } } }])
  let generation = 0
  f.host.register({ manifest: { schemaVersion: 1, id: 'odk.source.weather', name: 'Weather', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: DATA_PORTS.weather }] }, create: () => {
    const temperature = ++generation
    return { ports: { [DATA_PORTS.weather]: { refresh: async () => ({ status: 'live', current: { temperature } }) } } }
  } })
  await f.host.start()
  const registry = f.host.get(DESK_PORTS.data).registry
  assert.deepEqual(registry.publish('timer', { remaining_seconds: 42 }), { ok: true })
  const previous = await registry.read('timer')
  await f.host.setEnabled('odk.source.weather', false)
  assert.equal(f.host.get(DESK_PORTS.data).registry, registry)
  assert.equal(registry.has('odk.tile.weather'), false)
  assert.deepEqual(await registry.read('timer'), previous)
  await f.host.setEnabled('odk.source.weather', true)
  assert.equal((await registry.read('odk.tile.weather')).reading.value.temperatureC, 2)
  assert.deepEqual(await registry.read('timer'), previous)
  await f.host.stop()
})

test('Open DeskOS Data recovery reconciles catalog changes made while its port was disabled', async () => {
  const f = fixture()
  f.capabilities['desk.data'].create = require('../src/odk-data').createShellOdkData
  const entry = { id: 'timer', name: 'Timer', revision: 'r1', data: { fields: { remaining_seconds: { type: 'number' } } } }
  f.catalog([entry])
  await f.host.start()
  const registry = f.host.get(DESK_PORTS.data).registry
  registry.publish('timer', { remaining_seconds: 42 })
  await f.host.setEnabled('odk.system.data', false)
  f.catalog([])
  await f.host.setEnabled('odk.system.data', true)
  assert.deepEqual(await registry.read('timer'), { ok: false, error: 'unknown-reading' })
  await f.host.setEnabled('odk.system.data', false)
  f.catalog([{ ...entry, revision: 'r2' }])
  await f.host.setEnabled('odk.system.data', true)
  assert.equal((await registry.read('timer')).reading.state, 'unconfigured')
  registry.publish('timer', { remaining_seconds: 10 })
  await f.host.setEnabled('odk.system.data', false)
  f.catalog([{ ...entry, revision: 'r3' }])
  await f.host.setEnabled('odk.system.data', true)
  assert.equal((await registry.read('timer')).reading.state, 'unconfigured')
  await f.host.stop()
})

test('a changed declaration at the same revision cannot retain a prior package publication', async () => {
  const f = fixture()
  f.capabilities['desk.data'].create = require('../src/odk-data').createShellOdkData
  const entry = { id: 'timer', name: 'Timer', revision: 'r1', data: { fields: { remaining_seconds: { type: 'number' } } } }
  f.catalog([entry])
  await f.host.start()
  const registry = f.host.get(DESK_PORTS.data).registry
  registry.publish('timer', { remaining_seconds: 42 })
  await f.host.setEnabled('odk.system.data', false)
  f.catalog([{ ...entry, data: { fields: { remaining_seconds: { type: 'string' } } } }])
  await f.host.setEnabled('odk.system.data', true)
  assert.equal((await registry.read('timer')).reading.state, 'unconfigured')
  await f.host.stop()
})

test('a cancelled catalog synchronization cannot restore removed package readings', async () => {
  const { createShellOdkData } = require('../src/odk-data')
  let release
  const pending = new Promise(resolve => { release = resolve })
  const controller = new AbortController()
  const previous = createShellOdkData({ signal: controller.signal, store: { list: () => pending } })
  const syncing = previous.syncPackages()
  controller.abort()
  const current = createShellOdkData({ registry: previous.registry, store: { list: async () => [] } })
  await current.syncPackages()
  release([{ id: 'removed', name: 'Removed', revision: 'r1', data: { fields: { count: { type: 'number' } } } }])
  await syncing
  assert.equal(current.registry.has('removed'), false)
})

test('Open DeskOS Data Link retries its retained listener after a failed close', async () => {
  const f = fixture()
  let closes = 0
  let opens = 0
  Object.assign(f.capabilities['desk.link'], { enabled: true, listen: async () => {
    opens++
    return { close: async () => { if (++closes === 1) throw Error('listener still owns resources') } }
  } })
  await f.host.start()
  await settle()
  await f.host.stop()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.transport.data').state, 'cleanup-failed')
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.data').state, 'cleanup-blocked')
  await assert.rejects(f.host.start(), /still owns resources/)
  await f.host.stop()
  assert.equal(closes, 2)
  assert.equal(opens, 1)
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.data').state, 'stopped')
})

test('a cancelled Open DeskOS Data Link startup retains a late listener when its close fails', async () => {
  const f = fixture()
  let resolveListen
  const listening = new Promise(resolve => { resolveListen = resolve })
  let closes = 0
  Object.assign(f.capabilities['desk.link'], { enabled: true, listen: () => listening })
  await f.host.start()
  const stopping = f.host.stop()
  resolveListen({ close: async () => { if (++closes === 1) throw Error('late listener close failed') } })
  await stopping
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.transport.data').state, 'cleanup-failed')
  await f.host.stop()
  assert.equal(closes, 2)
})

test('installed runtime receives the selected catalog instance', async t => {
  const f = fixture()
  t.after(() => f.host.stop())
  let selected
  f.capabilities['desk.user-apps'].start = async options => { selected = options.store }
  await f.host.start()
  assert.equal(selected, f.store)
})

test('default catalog owns verification and closes its verifier', async t => {
  const f = fixture()
  t.after(() => f.host.stop())
  let verify, closed = 0
  const bundle = { html: 'Fixture' }
  const verdict = { ok: false, error: 'controlled-verification-failure' }
  f.capabilities['desk.catalog'].createVerifier = () => ({
    verify(value) { assert.equal(value, bundle); return verdict },
    async close() { closed++ },
  })
  f.capabilities['desk.catalog'].create = options => { verify = options.verify; return f.store }
  await f.host.start()
  assert.equal(typeof verify, 'function')
  assert.equal(await verify(bundle), verdict)
  await f.host.stop()
  assert.equal(closed, 1)
})

test('default catalog rejects installation when its owned verifier rejects the draft', async t => {
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'odk-catalog-verify-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const workspace = path.join(root, 'workspace')
  const draft = path.join(workspace, 'apps/blocked')
  await fs.mkdir(draft, { recursive: true })
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'blocked', name: 'Blocked', version: '1', kind: 'app' }))
  await fs.writeFile(path.join(draft, 'index.html'), '<p>Controlled rejected draft</p>')
  const f = fixture()
  t.after(() => f.host.stop())
  let checked = 0, closed = 0, drained = 0
  f.capabilities['desk.catalog'] = {
    create: require('../src/user-app-store').createUserAppStore,
    options: { workspace, stateDir: path.join(root, 'state') },
    createVerifier: () => ({
      async verify(bundle) { checked++; assert.match(bundle.html, /Controlled rejected draft/); return { ok: false } },
      async drain() { drained++ },
      async close() { closed++ },
    }),
  }
  await f.host.start()
  const store = f.host.get(DESK_PORTS.catalog)
  assert.equal((await store.install('blocked')).error, 'verification-failed')
  assert.equal(checked, 1)
  await store.waitForVerification()
  assert.equal(drained, 1)
  assert.deepEqual(await store.list(), [])
  await f.host.stop()
  assert.equal(closed, 1)
})

test('catalog retains failed verifier cleanup and releases it on retry', async t => {
  const f = fixture()
  t.after(() => f.host.stop())
  let closed = 0
  f.capabilities['desk.catalog'].createVerifier = () => ({ verify() {}, async close() {
    if (++closed === 1) throw Error('Controlled verifier close failure')
  } })
  await f.host.start()
  await f.host.stop()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.package-catalog').state, 'cleanup-failed')
  await assert.rejects(f.host.start(), /still owns resources/)
  await f.host.stop()
  assert.equal(closed, 2)
})

test('catalog factory failure releases an already acquired verifier', async t => {
  const f = fixture()
  t.after(() => f.host.stop())
  let closed = 0
  f.capabilities['desk.catalog'].createVerifier = () => ({ verify() {}, async close() { closed++ } })
  f.capabilities['desk.catalog'].create = () => { throw Error('Controlled catalog construction failure') }
  await f.host.start()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.package-catalog').state, 'failed')
  assert.equal(closed, 1)
})
