const test = require('node:test')
const assert = require('node:assert/strict')
const { createHydraStore, ENV_STALE_MS } = require('../src/hydra-mqtt')

test('hydra store parses environment and node readings', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/temp', '24.5', now), true)
  assert.equal(store.applyMessage('hydra/main/humidity', '61.2', now), true)
  assert.equal(store.applyMessage('hydra/main/pressure', '1002.6', now), true)
  assert.equal(store.applyMessage('hydra/main/lux', '12340.0', now), true)
  assert.equal(store.applyMessage('hydra/node1/soil', '62.4', now), true)
  assert.equal(store.applyMessage('hydra/node1/pump', 'false', now), true)
  assert.equal(store.applyMessage('hydra/node1/online', 'true', now), true)
  assert.equal(store.applyMessage('hydra/node2/soil', 'NC', now), true)
  assert.equal(store.applyMessage('hydra/node2/pump', 'true', now), true)
  assert.equal(store.applyMessage('hydra/node2/online', 'true', now), true)

  const snapshot = store.snapshot(now)
  assert.equal(snapshot.configured, true)
  assert.deepEqual(snapshot.env, { tempC: 24.5, humidity: 61.2, pressureHpa: 1002.6, lux: 12340, updatedAt: now, stale: false })
  assert.equal(snapshot.nodes.length, 2)
  assert.deepEqual(snapshot.nodes[0], { id: 1, online: true, pump: false, soilPercent: 62.4, soilUpdatedAt: now })
  assert.equal(snapshot.nodes[1].soilPercent, null)
  assert.equal(snapshot.nodes[1].pump, true)
})

test('hydra store rejects foreign topics and malformed payloads', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('other/main/temp', '24.5', now), false)
  assert.equal(store.applyMessage('hydra/node9/soil', '50', now), false)
  assert.equal(store.applyMessage('hydra/node1/soil', 'junk', now), false)
  assert.equal(store.applyMessage('hydra/node1/pump', 'junk', now), false)
  assert.equal(store.applyMessage('hydra/main/temp', 'junk', now), false)
  assert.deepEqual(store.snapshot(now), { configured: true, connected: false, env: null, nodes: [] })
})

test('hydra store clamps soil to the healthy band and reports stale env', () => {
  const store = createHydraStore()
  const now = 1000
  store.applyMessage('hydra/node1/soil', '150', now)
  assert.equal(store.snapshot(now).nodes[0].soilPercent, 100)
  store.applyMessage('hydra/node2/soil', '-3', now)
  assert.equal(store.snapshot(now).nodes[1].soilPercent, 0)

  store.applyMessage('hydra/main/temp', '24.5', now)
  assert.equal(store.snapshot(now + ENV_STALE_MS - 1).env.stale, false)
  assert.equal(store.snapshot(now + ENV_STALE_MS + 1).env.stale, true)
})

test('hydra source is inert without a broker URL', () => {
  const { createHydraSource } = require('../src/hydra-mqtt')
  const source = createHydraSource({})
  assert.equal(source.configured, false)
  assert.deepEqual(source.snapshot(), { configured: false, connected: false, env: null, nodes: [] })
  source.stop()
})

test('hydra topic prefix override scopes parsing', () => {
  const store = createHydraStore({ topicPrefix: 'plants' })
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/temp', '20', now), false)
  assert.equal(store.applyMessage('plants/main/temp', '20', now), true)
  assert.equal(store.applyMessage('plants/node1/soil', '55', now), true)
  assert.equal(store.snapshot(now).env.tempC, 20)
  assert.equal(store.snapshot(now).nodes[0].soilPercent, 55)
})
