'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { createDataSourcePlugins, DATA_PORTS } = require('../src/plugins/data-sources')

test('Devices uses the existing Bridge client without acquiring a device transport', async () => {
  const client = { getDeviceSnapshot: () => ({ status: 'live' }) }
  const handlers = new Map()
  let captured
  const source = { dispatch: async () => ({ status: 'live' }), stop() {} }
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id) },
    'source.device-gateway': { create: options => { captured = options; return source } },
  } })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.test.remote-owner', name: 'Remote owner', version: '1.0.0', kind: 'transport', host: 'electron-main',
    provides: [{ interface: 'odk:transport/remote-link/v1' }] }, create: () => ({ ports: { 'odk:transport/remote-link/v1': { client } } }) })
  host.register(createDataSourcePlugins().find(p => p.manifest.id === 'odk.source.device-gateway'))
  await host.start()
  assert.equal(captured.client, client)
  assert.equal(await handlers.get('odk-device-gateway')({}, { type: 'status' }).then(x => x.status), 'live')
  await host.stop()
})

test('default Hydra uses the shared device facade even when old MQTT options remain', async () => {
  const { createHydraEspNowSource } = require('../src/hydra-espnow')
  const handlers = new Map(), events = new Set(), peer = '02:11:22:33:44:55'
  const gateway = { snapshot: () => ({ status: 'live', gateway: { status: 'live' }, remote: { mac: 'f0:9e:9e:11:23:cc' }, peers: [{ mac: peer, role: 'device', status: 'stale' }] }), onEvent: callback => { events.add(callback); return () => events.delete(callback) } }
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id) },
    'source.hydra': { create: () => assert.fail('legacy MQTT constructed'), connect: () => assert.fail('network opened'), createDefault: createHydraEspNowSource,
      options: { url: 'mqtts://old.invalid:8883', peerStore: { load: () => null, save: async () => {} }, authorize: event => event === 'trusted', setIntervalFn: () => null, clearIntervalFn() {} } },
  } })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.test.gateway-owner', name: 'Gateway', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: DATA_PORTS.deviceGateway }] }, create: () => ({ ports: { [DATA_PORTS.deviceGateway]: gateway } }) })
  host.register(createDataSourcePlugins().find(p => p.manifest.id === 'odk.source.hydra'))
  await host.start()
  assert.equal((await handlers.get('odk-hydra-device')('trusted', { type: 'status' })).status, 'unconfigured')
  assert.equal((await handlers.get('odk-hydra-device')('trusted', { type: 'bind', peer })).ok, true)
  assert.equal(events.size, 1)
  assert.equal((await handlers.get('odk-hydra-status')()).configured, true)
  assert.equal((await handlers.get('odk-hydra-device')('trusted', { type: 'status' })).status, 'syncing')
  await host.stop(); assert.equal(events.size, 0); assert.equal(handlers.has('odk-hydra-device'), false)
})

test('explicit legacy Hydra capability does not request the new gateway dependency', () => {
  const definition = createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.hydra')
  const options = { url: 'mqtt://legacy.fixture', topicPrefix: 'plants' }
  const source = { snapshot: () => ({ configured: false }), stop() {} }
  const cleanups = [], handlers = new Map()
  let constructions = 0
  const capability = { options, create(incoming) {
    assert.equal(incoming, options)
    constructions++
    return source
  } }
  const context = {
    capability: name => name === 'source.hydra' ? capability : {
      handle: (id, handler) => handlers.set(id, handler), removeHandler: id => handlers.delete(id),
    },
    get: () => { throw Error('undeclared gateway port in legacy reference graph') },
    onCleanup: cleanup => cleanups.push(cleanup),
  }
  // An alias still selects the default branch, so the legacy reference fixture
  // must omit createDefault instead of pointing it at the legacy constructor.
  capability.createDefault = capability.create
  assert.throws(() => definition.create(context), /undeclared gateway port/)
  assert.equal(constructions, 0)
  delete capability.createDefault
  const created = definition.create(context)
  assert.equal(created.ports[DATA_PORTS.hydra], source)
  assert.equal(constructions, 1)
  assert.deepEqual(handlers.get('odk-hydra-status')(), { configured: false })
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.equal(handlers.size, 0)
})

function fixture() {
  const handlers = new Map()
  const calls = []
  const snapshots = {
    hydra: { connected: true, nodes: [{ soilPercent: 30 }] },
    weather: { status: 'live', temperatureC: 21.4 },
    weread: { status: 'ready', highlight: 'A reading' },
    camera: { state: 'live', image: 'data:image/jpeg;base64,fixture' },
    quota: { state: 'available', snapshot: { accounts: [] } },
    sessions: { ok: true, sessions: [{ sessionId: 'session' }] },
    events: { ok: true, events: [{ type: 'assistant', body: 'Result' }] },
  }
  const odkLink = { machines: async () => [] }
  const capabilities = {
    'source.device-gateway': { create: () => ({ stop() {}, dispatch: async () => ({ status: 'unconfigured' }) }) },
    ipc: { handle: (id, handler) => handlers.set(id, handler), removeHandler: id => handlers.delete(id) },
    'source.odk-link': { create: () => odkLink },
    'source.pi-sessions': { create: options => {
      assert.equal(options.odkLink, odkLink)
      return async () => snapshots.sessions
    } },
    'source.pi-events': { create: options => {
      assert.equal(options.odkLink, odkLink)
      return async request => { calls.push(['events', request]); return snapshots.events }
    } },
    'source.hydra': { create: options => {
      calls.push(['hydra-config', options])
      return { snapshot: () => snapshots.hydra, stop: () => calls.push(['hydra-stop']) }
    }, options: { url: 'fixture', topicPrefix: 'fixture' } },
    'source.weather': { create: options => {
      calls.push(['weather-config', options])
      return { refresh: async request => { calls.push(['weather-refresh', request]); return snapshots.weather } }
    }, options: { latitude: null, longitude: null } },
    'source.weread': { create: options => ({ refresh: async () => calls.push(['weread-refresh']), snapshot: () => snapshots.weread }), options: { cacheFile: '/fixture/cache' } },
    'source.camera': { create: () => ({ refresh: async () => calls.push(['camera-refresh']), snapshot: () => snapshots.camera }) },
    'source.quota': { read: async () => snapshots.quota },
  }
  return { handlers, calls, snapshots, capabilities }
}

test('packaged source plugins preserve every existing reading IPC payload', async () => {
  const f = fixture()
  const host = createPluginHost({ capabilities: f.capabilities })
  for (const plugin of createDataSourcePlugins()) host.register(plugin)
  await host.start()
  const invoke = (name, request) => f.handlers.get(name)(null, request)
  for (const [channel, source] of [
    ['odk-hydra-status', 'hydra'], ['odk-weather-status', 'weather'], ['odk-weread-highlight', 'weread'],
    ['odk-camera-frame', 'camera'], ['odk-opencode-go-status', 'quota'], ['odk-pi-sessions', 'sessions'],
    ['odk-pi-session-events', 'events'],
  ]) assert.equal(await invoke(channel, {}), f.snapshots[source])
  assert.equal(host.get(DATA_PORTS.hydra).snapshot(), f.snapshots.hydra)
  assert.equal(await host.get(DATA_PORTS.piSessions)(), f.snapshots.sessions)
  await host.stop()
  assert.equal(f.handlers.size, 0)
  assert.deepEqual(f.calls.filter(([name]) => name === 'hydra-stop'), [['hydra-stop']])
})

test('weather force refresh and Pi event arguments keep the public contract', async () => {
  const f = fixture()
  const host = createPluginHost({ capabilities: f.capabilities })
  for (const plugin of createDataSourcePlugins()) host.register(plugin)
  await host.start()
  await f.handlers.get('odk-weather-status')(null, { force: true })
  await f.handlers.get('odk-weather-status')(null)
  await f.handlers.get('odk-pi-session-events')(null, { cwd: '/project', sessionId: 'one', hostedPi: true, extra: 'ignored' })
  await f.handlers.get('odk-pi-session-events')(null, { cwd: 1, sessionId: null, hostedPi: 1 })
  assert.deepEqual(f.calls.filter(([name]) => name === 'weather-refresh').map(([, request]) => request), [{ force: true }, { force: false }])
  assert.deepEqual(f.calls.filter(([name]) => name === 'events').map(([, request]) => request), [
    { cwd: '/project', sessionId: 'one', hostedPi: true }, { cwd: '', sessionId: '', hostedPi: false },
  ])
  await host.stop()
})

test('a replacement weather provider feeds the same endpoint without changing its consumers', async () => {
  const f = fixture()
  const replacement = { status: 'stale', temperatureC: 19 }
  f.capabilities['source.weather'].create = () => ({ refresh: async () => replacement })
  const host = createPluginHost({ capabilities: f.capabilities })
  for (const plugin of createDataSourcePlugins()) host.register(plugin)
  await host.start()
  assert.equal(await f.handlers.get('odk-weather-status')(null), replacement)
  assert.equal(await host.get(DATA_PORTS.weather).refresh(), replacement)
  assert.equal(f.handlers.get('odk-hydra-status')(), f.snapshots.hydra)
  await host.stop()
})

test('one disabled source leaves unrelated endpoints running', async () => {
  const f = fixture()
  const host = createPluginHost({ capabilities: f.capabilities, disabled: ['odk.source.weather'] })
  for (const plugin of createDataSourcePlugins()) host.register(plugin)
  await host.start()
  assert.equal(f.handlers.has('odk-weather-status'), false)
  assert.equal(f.handlers.get('odk-hydra-status')(), f.snapshots.hydra)
  assert.equal(host.get(DATA_PORTS.weather), null)
  await host.setEnabled('odk.source.weather', true)
  assert.equal(await f.handlers.get('odk-weather-status')(null), f.snapshots.weather)
  await host.stop()
})

test('an independent source factory publishes readings from its own instance without a central source key', async () => {
  const { createSourcePlugin } = require('../src/plugins/data-sources')
  let serial = 0
  const dispatched = new Map()
  const stopped = []
  const host = createPluginHost({ capabilities: {
    'source.independent': { create: () => ({ sequence: ++serial }) },
    ipc: { handle: (channel, handler) => dispatched.set(channel, handler), removeHandler: channel => dispatched.delete(channel) },
  } })
  host.register(createSourcePlugin({ id: 'independent', name: 'Independent reading', port: 'odk:source/independent/v1',
    channels: { 'independent-reading': source => source.sequence },
    createReadings: source => [{ id: 'odk.tile.independent', label: 'Independent', kind: 'tile', read: async () => ({ state: 'live', value: source.sequence }) }],
    stop: source => stopped.push(source.sequence),
  }))
  await host.start()
  const port = 'odk:desk-reading/independent/v1'
  assert.equal((await host.get(port)[0].read()).value, dispatched.get('independent-reading')())
  await host.setEnabled('odk.source.independent', false)
  await host.setEnabled('odk.source.independent', true)
  assert.equal((await host.get(port)[0].read()).value, 2)
  assert.equal(dispatched.get('independent-reading')(), 2)
  assert.deepEqual(stopped, [1])
  await host.stop()
  assert.deepEqual(stopped, [1, 2])
  assert.equal(dispatched.size, 0)
})

test('legacy Pi scan callers retain their method receiver', async () => {
  const { createDefaultSourceReadings } = require('../src/plugins/desk-readings')
  const piSessions = { sessions: [{ id: 'fixture', status: 'idle' }], async scan() { return { ok: true, sessions: this.sessions } } }
  const entry = createDefaultSourceReadings({ piSessions })[0]
  assert.equal((await entry.read()).value.total, 1)
})

test('invalid source reading factories fail before publishing ports and release owned resources', async () => {
  const { createSourcePlugin } = require('../src/plugins/data-sources')
  const handlers = new Map()
  let stopped = 0
  const host = createPluginHost({ capabilities: {
    'source.invalid': { create: () => ({}) },
    ipc: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) },
  } })
  host.register(createSourcePlugin({ id: 'invalid', name: 'Invalid source', port: 'odk:source/invalid/v1',
    channels: { invalid: () => null }, createReadings: () => ({}), stop: () => { stopped++ },
  }))
  await host.start()
  assert.equal(host.list()[0].state, 'failed')
  assert.match(host.list()[0].error, /reading factory requires an array/)
  assert.equal(host.get('odk:source/invalid/v1'), null)
  assert.equal(handlers.size, 0)
  assert.equal(stopped, 1)
  await host.stop()
  assert.equal(stopped, 1)
})
