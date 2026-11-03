'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createDataSourcePlugins } = require('../src/plugins/data-sources')
const { READING_PORT } = require('../src/plugins/personal-agent-readings')
const { HYDRA_PROJECTION_ID, readCentralHydraSnapshot } = require('../src/hydra-projection')

const snapshot = () => ({
  configured: true, connected: true, mainOnline: true,
  env: { tempC: 28.3, humidity: 69, pressureHpa: 1014, lux: 0.83, stale: false, updatedAt: 1000 },
  nodes: [
    { id: 1, soilPercent: 50, pump: false, online: true, stale: false, soilStale: false, soilUpdatedAt: 900 },
    { id: 2, soilPercent: 55, pump: false, online: true, stale: false, soilStale: false, soilUpdatedAt: 900 },
  ],
  updatedAt: 1000,
})

function handler(local, port) {
  const definition = createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.hydra')
  const handlers = new Map()
  const source = { snapshot: () => local, stop() {} }
  const capability = { options: { source: 'mqtt' }, create: () => source, createDefault: undefined }
  const context = {
    capability: name => name === 'source.hydra' ? capability : {
      handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id),
    },
    get: name => name === READING_PORT ? port : undefined,
    onCleanup: () => {},
  }
  definition.create(context)
  return handlers.get('odk-hydra-status')
}

test('a display host with no local Hydra source shows the central reading', async () => {
  const local = { configured: false, connected: false, env: null, nodes: [] }
  const port = { refresh: async () => {}, readings: () => [{ id: HYDRA_PROJECTION_ID, read: async () => ({ id: HYDRA_PROJECTION_ID, state: 'live', value: { snapshot: snapshot() } }) }] }
  const result = await handler(local, port)()
  assert.equal(result.projection, true)
  assert.equal(result.nodes[0].soilPercent, 50)
  assert.equal(result.env.humidity, 69)
  assert.equal(result.nodes.length, 2)
})

test('a live local Hydra source keeps precedence over the central projection', () => {
  const local = { configured: true, connected: true, mainOnline: true, nodes: [], env: null }
  const port = { refresh: async () => { throw Error('projection must not be read') }, readings: () => [] }
  assert.equal(handler(local, port)(), local)
})

test('an unavailable or malformed projection states the local truth', async () => {
  const local = { configured: false, connected: false, env: null, nodes: [] }
  for (const value of [
    { id: HYDRA_PROJECTION_ID, state: 'unavailable', value: null },
    { id: HYDRA_PROJECTION_ID, state: 'live', value: { snapshot: { ...snapshot(), nodes: [{ id: 1, soilPercent: 900 }] } } },
    { id: HYDRA_PROJECTION_ID, state: 'live', value: { snapshot: { ...snapshot(), connected: false } } },
    { id: 'other.source', state: 'live', value: { snapshot: snapshot() } },
  ]) {
    const port = { refresh: async () => {}, readings: () => [{ id: HYDRA_PROJECTION_ID, read: async () => value }] }
    assert.equal(await handler(local, port)(), local)
  }
  assert.equal(await readCentralHydraSnapshot(undefined), null)
})
