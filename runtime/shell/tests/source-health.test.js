'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { getHydraHealth } = require('../src/plugins/readings/hydra')
const { getWeatherHealth } = require('../src/plugins/readings/weather')
const { getWereadHealth } = require('../src/plugins/readings/weread')

test('source-owned health mappings retain current availability states and exclude reading payloads', () => {
  for (const [probe, cases] of [
    [getHydraHealth, [[{ configured: false }, 'degraded'], [{ configured: true, connected: false }, 'failed'], [{ connected: true, env: { stale: true } }, 'degraded'], [{ connected: true }, 'healthy']]],
    [getWeatherHealth, ['live', 'stale', 'unavailable', 'unconfigured', 'other'].map((status, index) => [{ status }, ['healthy', 'degraded', 'failed', 'degraded', 'unknown'][index]])],
    [getWereadHealth, ['live', 'empty', 'loading', 'unconfigured', 'error', 'other'].map((status, index) => [{ status }, ['healthy', 'healthy', 'degraded', 'degraded', 'failed', 'unknown'][index]])],
  ]) {
    for (const [snapshot, state] of cases) {
      const value = { ...snapshot, updatedAt: 1234, secret: 'fixture-secret', temperature: 99 }
      const result = probe({ snapshot: () => value, refresh() { throw Error('must not refresh') } })
      assert.equal(result.state, state)
      assert.equal(result.updatedAt, 1234)
      assert.equal(JSON.stringify(result).includes('fixture-secret'), false)
      assert.equal(Object.hasOwn(result, 'temperature'), false)
    }
    assert.deepEqual(probe({}), { state: 'unknown', reason: 'snapshot-unavailable' })
  }
})

test('asynchronous underlying snapshots fail explicitly without an unhandled rejection', () => {
  for (const probe of [getHydraHealth, getWeatherHealth, getWereadHealth]) {
    assert.deepEqual(probe({ snapshot: () => Promise.reject(Error('private fixture details')) }), { state: 'failed', reason: 'invalid-source-snapshot' })
  }
})


test('Camera declares health that reads only the cached source state', async () => {
  const { createPluginHost } = require('../src/plugin-host')
  const { createDataSourcePlugins } = require('../src/plugins/data-sources')
  const { healthPort } = require('../src/plugins/health')
  const { createCameraSource } = require('../src/camera-source')
  const source = createCameraSource({
    fsImpl: { existsSync() { throw Error('health must not access the device') } },
    execFileImpl() { throw Error('health must not capture') },
  })
  let snapshotCalls = 0
  const snapshot = source.snapshot
  source.snapshot = () => { snapshotCalls++; return snapshot() }
  const host = createPluginHost({ capabilities: {
    'source.camera': { create: () => source },
    ipc: { handle() {}, removeHandler() {} },
  } })
  host.register(createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.camera'))
  await host.start()
  const health = host.get(healthPort('odk.source.camera'))
  assert.ok(health)
  assert.deepEqual(health.snapshot(), { state: 'failed', reason: 'unavailable' })
  assert.equal(snapshotCalls, 1)
  source.snapshot = () => ({ status: 'live', capturedAt: 1234, frame: 'private-image', device: '/private/device', error: 'private-error' })
  assert.deepEqual(health.snapshot(), { state: 'healthy', reason: 'cached-frame', updatedAt: 1234 })
  source.snapshot = () => ({ status: 'unknown', capturedAt: NaN })
  assert.deepEqual(health.snapshot(), { state: 'unknown', reason: 'source-state-unknown' })
  source.snapshot = () => Promise.reject(Error('private capture details'))
  assert.deepEqual(health.snapshot(), { state: 'failed', reason: 'invalid-source-snapshot' })
  await host.stop()
})
