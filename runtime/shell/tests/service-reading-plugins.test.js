'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { selectIndependentCoordinators } = require('./fixtures/service-coordinator-replacements')
const { createShellOdkData } = require('../src/odk-data')
const { createPluginHost } = require('../src/plugin-host')
const { createDeskRuntimePlugins, DESK_PORTS } = require('../src/plugins/desk-runtime')

function entry(id, value) { return { id, label: id, kind: 'service', read: async () => ({ state: 'live', value: { count: value } }) } }

test('generic service readings reconcile without Futu-specific arguments', async () => {
  let entries = [entry('custom', 1)]
  const data = createShellOdkData({ readings: [], serviceReadings: () => entries })
  assert.equal((await data.registry.read('custom')).reading.value.count, 1)
  entries = [entry('next', 2)]
  data.syncServices()
  assert.equal(data.registry.has('custom'), false)
  assert.equal((await data.registry.read('next')).reading.value.count, 2)
  entries = [entry('next', 3), entry('next', 4)]
  assert.throws(() => data.syncServices(), /conflicting-service-reading/)
  assert.equal((await data.registry.read('next')).reading.value.count, 2)
})

test('a declared service reading port supports provider replacement and withdrawal', async () => {
  const port = 'odk:desk-service-readings/fixture/v1'
  let generation = 0
  const host = createPluginHost({ disabled: ['odk.service.futu', 'odk.system.service-refresh', 'odk.system.user-apps', 'odk.transport.data'], capabilities: {
    'desk.catalog': { create: () => ({ list: async () => [] }) },
    'desk.data': { create: createShellOdkData, smokeMode: true },
  } })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.service.fixture', name: 'Fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }] }, create() {
    const value = ++generation
    return { ports: { [port]: { readings: () => [entry('custom', value)] } } }
  } })
  for (const definition of createDeskRuntimePlugins({ readingPorts: [], serviceReadingPorts: [port] })) host.register(definition)
  await host.start()
  const registry = host.get(DESK_PORTS.data).registry
  assert.equal((await registry.read('custom')).reading.value.count, 1)
  await host.setEnabled('odk.service.fixture', false)
  assert.equal(registry.has('custom'), false)
  await host.setEnabled('odk.service.fixture', true)
  assert.equal((await registry.read('custom')).reading.value.count, 2)
  await host.stop()
})


for (const independent of [false, true]) {
test(`${independent ? 'independent' : 'default'} service refresh continues for a declared provider when Futu is disabled`, async () => {
  const port = 'odk:desk-service-readings/fixture/v1'
  let value = 0
  let tick
  let reports = []
  const host = createPluginHost({ disabled: ['odk.service.futu', 'odk.system.user-apps', 'odk.transport.data'], capabilities: {
    'desk.catalog': { create: () => ({ list: async () => [] }) },
    'desk.data': { create: createShellOdkData, smokeMode: false },
    'desk.refresh': { setInterval: fn => { tick = fn; return { unref() {} } }, clearInterval() {}, report: error => reports.push(error) },
  } })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.service.fixture', name: 'Fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }] }, create: () => ({ ports: {
    [port]: { readings: () => [entry(`custom-${value}`, value)], refresh: async () => { value++ } },
  } }) })
  const definitions = createDeskRuntimePlugins({ readingPorts: [], serviceReadingPorts: [port] })
  for (const definition of independent ? selectIndependentCoordinators(definitions) : definitions) host.register(definition)
  await host.start()
  await new Promise(resolve => setImmediate(resolve))
  const registry = host.get(DESK_PORTS.data).registry
  assert.equal(registry.has('custom-1'), true)
  tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(registry.has('custom-1'), false)
  assert.equal((await registry.read('custom-2')).reading.value.count, 2)
  assert.deepEqual(reports, [])
  await host.stop()
})

test(`${independent ? 'independent' : 'default'} a refresh or diagnostic failure cannot prevent another service from refreshing`, async () => {
  const bad = 'odk:desk-service-readings/bad/v1'
  const good = 'odk:desk-service-readings/good/v1'
  const order = []
  let value = 0
  const host = createPluginHost({ disabled: ['odk.service.futu', 'odk.system.user-apps', 'odk.transport.data'], capabilities: {
    'desk.catalog': { create: () => ({ list: async () => [] }) },
    'desk.data': { create: createShellOdkData },
    'desk.refresh': { setInterval: () => ({ unref() {} }), clearInterval() {}, report() { throw Error('diagnostic unavailable') } },
  } })
  for (const [name, port, provider] of [
    ['bad', bad, { readings: () => [], refresh: async () => { order.push('bad'); throw Error('refresh unavailable') } }],
    ['good', good, { readings: () => [entry('custom', value)], refresh: async () => { order.push('good'); value++ } }],
  ]) host.register({ manifest: { schemaVersion: 1, id: `odk.service.${name}`, name, version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }] }, create: () => ({ ports: { [port]: provider } }) })
  const definitions = createDeskRuntimePlugins({ readingPorts: [], serviceReadingPorts: [bad, good] })
  for (const definition of independent ? selectIndependentCoordinators(definitions) : definitions) host.register(definition)
  await host.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await host.get(DESK_PORTS.data).registry.read('custom')).reading.value.count, 1)
  assert.deepEqual(order, ['bad', 'good'])
  await host.stop()
})

test(`${independent ? 'independent' : 'default'} shutdown and provider disable drain an active refresh before provider stop`, async () => {
  for (const action of ['stop', 'disable']) {
    const port = 'odk:desk-service-readings/fixture/v1'
    const events = []
    let finishRefresh
    const gate = new Promise(resolve => { finishRefresh = resolve })
    let tick
    let timers = 0
    const host = createPluginHost({ disabled: ['odk.service.futu', 'odk.system.user-apps', 'odk.transport.data'], capabilities: {
      'desk.catalog': { create: () => ({ list: async () => [] }) },
      'desk.data': { create: createShellOdkData },
      'desk.refresh': { setInterval: fn => { tick = fn; timers++; return { unref() {} } }, clearInterval() { timers-- }, report() {} },
    } })
    host.register({ manifest: { schemaVersion: 1, id: 'odk.service.fixture', name: 'Fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }] }, create: () => ({
      ports: { [port]: { readings: () => [entry('custom', 1)], refresh: async () => { events.push('refresh-start'); await gate; events.push('refresh-end') } } },
      stop: () => events.push('provider-stop'),
    }) })
    const definitions = createDeskRuntimePlugins({ readingPorts: [], serviceReadingPorts: [port] })
  for (const definition of independent ? selectIndependentCoordinators(definitions) : definitions) host.register(definition)
    await host.start()
    assert.equal(timers, 1)
    assert.equal(tick(), tick(), 'overlapping refresh requests must share one operation')
    const stopping = action === 'stop' ? host.stop() : host.setEnabled('odk.service.fixture', false)
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(events, ['refresh-start'])
    } finally {
      finishRefresh()
      await stopping
      await host.stop()
    }
    assert.deepEqual(events, ['refresh-start', 'refresh-end', 'provider-stop'])
    assert.equal(timers, 0)
    const previous = [...events]
    await tick()
    assert.deepEqual(events, previous, 'retained timer callback must be inert after stop')
  }
})

}
