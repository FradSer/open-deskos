'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createDataSourcePlugins } = require('../src/plugins/data-sources')
const { SYSTEM_PORTS } = require('../src/plugins/system-channels')
const { READING_PORT } = require('../src/plugins/personal-agent-readings')

const projection = {
  configured: true, connected: true, mainOnline: true,
  env: { tempC: 28.3, humidity: 69, pressureHpa: 1014, lux: 0.83, stale: false, updatedAt: 1000 },
  nodes: [
    { id: 1, soilPercent: 50, pump: false, online: true, stale: false, soilStale: false, soilUpdatedAt: 900 },
    { id: 2, soilPercent: 55, pump: false, online: true, stale: false, soilStale: false, soilUpdatedAt: 900 },
  ],
  updatedAt: 1000,
}

const definition = () => createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.hydra')

test('the Hydra source declares the Personal Agent port it reads', () => {
  const required = definition().manifest.requires.map(entry => entry.interface)
  assert.ok(required.includes(SYSTEM_PORTS.personalAgent),
    'ctx.get throws for undeclared ports, so the status projection port must be declared')
  const optional = definition().manifest.requires.filter(entry => entry.optional).map(entry => entry.interface)
  assert.ok(optional.includes(SYSTEM_PORTS.personalAgent), 'the port stays optional on hosts without a resident agent')
})

test('a strict host still returns the status projection', async () => {
  const declared = new Set(definition().manifest.requires.map(entry => entry.interface))
  const handlers = new Map()
  const local = { configured: false, connected: false, env: null, nodes: [] }
  const source = { snapshot: () => local, stop() {} }
  const personalAgent = { snapshot: () => ({ state: 'idle', hydra: projection }) }
  const port = { refresh: async () => {}, readings: () => [] }
  const context = {
    capability: name => name === 'source.hydra'
      ? { options: { source: 'mqtt' }, create: () => source, createDefault: undefined }
      : { handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id) },
    // Reproduce plugin-host: reading an undeclared port throws.
    get: name => {
      if (!declared.has(name)) throw Error(`undeclared port ${name}`)
      return name === READING_PORT ? port : name === SYSTEM_PORTS.personalAgent ? personalAgent : null
    },
    onCleanup: () => {},
  }
  definition().create(context)
  const result = await handlers.get('odk-hydra-status')()
  assert.equal(result.projection, true, 'the Widget receives live readings instead of Unconfigured')
  assert.equal(result.env.humidity, 69)
})
