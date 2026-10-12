'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { getFutuHealth } = require('../src/plugins/readings/futu')
const { healthPort } = require('../src/plugins/health')
const { createPluginHost } = require('../src/plugin-host')
const { createDeskRuntimePlugins, DESK_PORTS } = require('../src/plugins/desk-runtime')
const { createDiagnosticsPlugin, requestDiagnostics } = require('../src/plugin-diagnostics')
const { posixOnlyReason } = require('./not-ported')

test('Futu health reports each source state without holdings or authentication details', () => {
  for (const [state, expected] of [['live', 'healthy'], ['needs-auth', 'degraded'], ['syncing', 'degraded'], ['unconfigured', 'degraded'], ['unavailable', 'failed'], ['other', 'unknown']]) {
    const result = getFutuHealth({ snapshot: id => ({ state, service: id, updatedAt: 1234, error: 'private-fixture', secrets: ['private-fixture'], snapshot: { positions: ['private-fixture'] } }) }, { portfolio: 'Private label' })
    assert.equal(result.state, expected)
    assert.equal(result.components[0].id, 'portfolio')
    assert.equal(result.components[0].state, expected)
    assert.equal(result.components[0].updatedAt, 1234)
    assert.equal(JSON.stringify(result).includes('private-fixture'), false)
    assert.equal(JSON.stringify(result).includes('Private label'), false)
  }
})

test('aggregate service health retains partial failures and isolates broken snapshots', () => {
  const source = { snapshot: id => {
    if (id === 'broken') throw Error('private-fixture')
    if (id === 'async') return Promise.reject(Error('private-fixture'))
    return { state: id === 'good' ? 'live' : 'unavailable' }
  } }
  assert.equal(getFutuHealth(source, {}).state, 'degraded')
  assert.equal(getFutuHealth(source, { good: {} }).state, 'healthy')
  assert.equal(getFutuHealth(source, { bad: {} }).state, 'failed')
  const result = getFutuHealth(source, { good: {}, bad: {}, broken: {}, async: {} })
  assert.equal(result.state, 'degraded')
  assert.deepEqual(result.components.map(component => component.state), ['healthy', 'failed', 'failed', 'failed'])
  assert.equal(JSON.stringify(result).includes('private-fixture'), false)
})

test('Futu declared health reaches authenticated diagnosis and follows service reconciliation', { skip: posixOnlyReason('unix-socket') }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-futu-health-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const endpoint = path.join(root, 'diagnose.sock')
  const port = healthPort('odk.service.futu')
  let installed = [{ id: 'notes', name: 'Private label', revision: 'r1', service: { id: 'one' } }, { id: 'clock', revision: 'r2', service: { id: 'two' } }]
  let refreshed = 0
  const host = createPluginHost({ capabilities: {
    'plugin.diagnostics': { endpoint, snapshot: () => host.list() },
    'desk.catalog': { create: () => ({ list: async () => installed }) },
    'desk.futu': { env: {}, report() {}, create: () => ({ snapshot: id => ({ state: id === 'one' ? 'live' : 'needs-auth', updatedAt: 1000 }), refreshServices: async () => { refreshed++ }, stop() {} }) },
    ipc: { handle() {}, removeHandler() {} },
  } })
  for (const plugin of createDeskRuntimePlugins({ readingPorts: [] }).filter(plugin => ['odk.system.package-catalog', 'odk.service.futu'].includes(plugin.manifest.id))) host.register(plugin)
  host.register(createDiagnosticsPlugin({ healthPorts: [port] }))
  await host.start()
  t.after(() => host.stop())
  await host.get(DESK_PORTS.futu).refresh()
  const diagnose = async () => (await requestDiagnostics({ endpoint, pluginId: 'odk.service.futu' })).plugins[0]
  let result = await diagnose()
  assert.equal(result.state, 'running')
  assert.equal(result.health.state, 'degraded')
  assert.deepEqual(result.health.components.map(component => component.id), ['one', 'two'])
  assert.equal(refreshed, 1)
  installed = [installed[0]]
  await host.get(DESK_PORTS.futu).refresh()
  result = await diagnose()
  assert.equal(result.health.state, 'healthy')
  assert.deepEqual(result.health.components.map(component => component.id), ['one'])
  assert.equal(refreshed, 2)
  await host.setEnabled('odk.service.futu', false)
  assert.equal((await diagnose()).health.state, 'unknown')
})
