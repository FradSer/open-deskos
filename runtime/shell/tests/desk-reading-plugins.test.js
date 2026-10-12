'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { createDeskRuntimePlugins, DESK_PORTS } = require('../src/plugins/desk-runtime')
const { createShellDeskData } = require('../src/desk-data')

test('a declared reading joins Desk Data, withdraws on disable and uses its replacement', async () => {
  const port = 'odk:desk-reading/fixture/v1'
  let generation = 0
  const host = createPluginHost({ disabled: ['odk.system.service-refresh', 'odk.system.user-apps', 'odk.transport.desk-data', 'odk.service.futu'], capabilities: {
    'desk.catalog': { create: () => ({ list: async () => [] }) },
    'desk.data': { create: createShellDeskData, smokeMode: true },
  } })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.source.fixture', name: 'Fixture reading', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }] }, create() {
    const current = ++generation
    return { ports: { [port]: [{ id: 'odk.tile.fixture', label: 'Fixture', kind: 'tile', read: async () => ({ state: 'live', value: { generation: current } }) }] } }
  } })
  for (const definition of createDeskRuntimePlugins({ readingPorts: [port] })) host.register(definition)
  await host.start()
  const registry = host.get(DESK_PORTS.data).registry
  assert.equal((await registry.read('odk.tile.fixture')).reading.value.generation, 1)
  registry.register({ id: 'timer', label: 'Timer', kind: 'package', revision: 'r1', declaration: { fields: { count: { type: 'number' } } } })
  registry.publish('timer', { count: 42 })
  const publication = await registry.read('timer')
  await host.setEnabled('odk.source.fixture', false)
  assert.equal(registry.has('odk.tile.fixture'), false)
  assert.deepEqual(await registry.read('timer'), publication)
  await host.setEnabled('odk.source.fixture', true)
  assert.equal((await registry.read('odk.tile.fixture')).reading.value.generation, 2)
  await host.stop()
})


test('service refresh only withdraws readings owned by the Futu service contribution', async () => {
  let declarations = { portfolio: 'Portfolio' }
  const data = createShellDeskData({ readings: [{ id: 'odk.service.fixture', label: 'Fixture service', kind: 'service', read: async () => ({ state: 'live', value: { count: 7 } }) }],
    futu: { snapshot: () => ({ state: 'unavailable' }) }, services: () => declarations })
  assert.equal(data.registry.has('portfolio'), true)
  declarations = {}
  data.syncServices()
  assert.equal(data.registry.has('portfolio'), false)
  assert.equal((await data.registry.read('odk.service.fixture')).reading.value.count, 7)
})

test('invalid or conflicting source contributions leave existing registry values intact', async () => {
  const data = createShellDeskData({ readings: [{ id: 'odk.tile.fixture', label: 'Fixture', kind: 'tile', read: async () => ({ state: 'live', value: { count: 7 } }) }] })
  data.registry.register({ id: 'timer', label: 'Timer', kind: 'package', revision: 'r1', declaration: { fields: { count: { type: 'number' } } } })
  data.registry.publish('timer', { count: 42 })
  const publication = await data.registry.read('timer')
  for (const entries of [
    [{ id: 'timer', label: 'Conflict', kind: 'tile', read() {} }],
    [{ id: 'odk.tile.new', label: 'New', kind: 'tile', read() {} }, { id: 'odk.tile.new', label: 'Duplicate', kind: 'tile', read() {} }],
    [{ id: 'odk.tile.new', label: 'New', kind: 'tile', read() {} }, { id: 'odk.tile.bad', label: 'Bad', kind: 'tile' }],
  ]) {
    assert.throws(() => createShellDeskData({ registry: data.registry, readings: entries }))
    assert.equal((await data.registry.read('odk.tile.fixture')).reading.value.count, 7)
    assert.deepEqual(await data.registry.read('timer'), publication)
    assert.equal(data.registry.has('odk.tile.new'), false)
  }
})

test('service validation failure cannot partially replace source readings', async () => {
  const entry = count => ({ id: 'odk.tile.fixture', label: 'Fixture', kind: 'tile', read: async () => ({ state: 'live', value: { count } }) })
  const data = createShellDeskData({ readings: [entry(1)], store: { list: async () => [] } })
  data.registry.register({ id: 'timer', label: 'Timer', kind: 'package', declaration: { fields: { count: { type: 'number' } } } })
  data.registry.publish('timer', { count: 42 })
  const original = data.registry.list()
  assert.throws(() => createShellDeskData({ registry: data.registry, readings: [entry(2)], services: () => ({ timer: 'Collision' }) }), /conflicting-service-reading/)
  assert.deepEqual(data.registry.list(), original)
  assert.equal((await data.registry.read('odk.tile.fixture')).reading.value.count, 1)
})

test('package synchronization cannot overwrite a contributed source reading', async () => {
  const data = createShellDeskData({ readings: [{ id: 'timer', label: 'Source timer', kind: 'service', read: async () => ({ state: 'live', value: { count: 7 } }) }],
    store: { list: async () => [{ id: 'timer', name: 'Package timer', data: { fields: { count: { type: 'number' } } } }] } })
  await assert.rejects(data.syncPackages(), /conflicting-package-reading/)
  assert.equal((await data.registry.read('timer')).reading.value.count, 7)
})
