const test = require('node:test')
const assert = require('node:assert/strict')
const { createHydraStore, ENV_STALE_MS, NODE_STALE_MS } = require('../src/hydra-mqtt')

test('hydra store parses atomic environment and node readings', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340.0;d=1.23', now), true)
  assert.equal(store.applyMessage('hydra/node1/soil', '62.4', now), true)
  assert.equal(store.applyMessage('hydra/node1/pump', 'false', now), true)
  assert.equal(store.applyMessage('hydra/node1/online', 'true', now), true)
  assert.equal(store.applyMessage('hydra/node2/soil', 'NC', now), true)
  assert.equal(store.applyMessage('hydra/node2/pump', 'true', now), true)
  assert.equal(store.applyMessage('hydra/node2/online', 'true', now), true)

  const snapshot = store.snapshot(now)
  assert.equal(snapshot.configured, true)
  assert.deepEqual(snapshot.env, { tempC: 24.5, humidity: 61.2, pressureHpa: 1002.6, lux: 12340, vpdKpa: 1.23, updatedAt: now, stale: false })
  assert.equal(snapshot.nodes.length, 2)
  assert.deepEqual(snapshot.nodes[0], { id: 1, online: true, pump: false, soilPercent: 62.4, soilUpdatedAt: now, updatedAt: now, stale: false })
  assert.equal(snapshot.nodes[1].soilPercent, null)
  assert.equal(snapshot.nodes[1].pump, true)
})

test('hydra store hydrates env from the retained summary topic', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340.0;d=1.23', now), true)
  const snapshot = store.snapshot(now)
  assert.equal(snapshot.env.tempC, 24.5)
  assert.equal(snapshot.env.humidity, 61.2)
  assert.equal(snapshot.env.pressureHpa, 1002.6)
  assert.equal(snapshot.env.lux, 12340)
  assert.equal(snapshot.env.vpdKpa, 1.23)
  assert.equal(snapshot.env.stale, false)
})

test('hydra summary without valid lux leaves lux unknown', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;l=0;t=24.5;h=61.2;p=1002.6;x=0.0001;d=1.23', now), true)
  const snapshot = store.snapshot(now)
  assert.equal(snapshot.env.tempC, 24.5)
  assert.equal(snapshot.env.lux, undefined)
  assert.equal(snapshot.env.vpdKpa, 1.23)
})

test('hydra invalid summary clears retained environment readings', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340.0;d=1.23', now), true)
  assert.equal(store.applyMessage('hydra/main/env', 'v=0', now + 1), true)
  assert.equal(store.snapshot(now + 1).env, null)
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;t=junk', now + 2), false)
  assert.equal(store.snapshot(now + 2).env, null)
})

test('hydra main heartbeat and automatic watering status update live state', () => {
  const store = createHydraStore()
  const now = 1000
  store.markConnected(true)
  assert.equal(store.applyMessage('hydra/main/online', 'true', now), true)
  assert.equal(store.applyMessage('hydra/node1/pump', 'false', now), true)
  assert.equal(store.applyMessage('hydra/node1/status', 'PULSE', now + 1), true)

  let snapshot = store.snapshot(now + 1)
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.mainOnline, true)
  assert.equal(snapshot.nodes[0].pump, true)
  assert.equal(snapshot.nodes[0].status, 'PULSE')

  assert.equal(store.applyMessage('hydra/node2/pump', 'true', now), true)
  assert.equal(store.applyMessage('hydra/node2/status', 'IDLE', now + 1), true)
  snapshot = store.snapshot(now + 1)
  assert.equal(snapshot.nodes[1].pump, false)

  snapshot = store.snapshot(now + 180000)
  assert.equal(snapshot.mainOnline, true)
  snapshot = store.snapshot(now + 180001)
  assert.equal(snapshot.mainOnline, false)
})

test('hydra snapshots expose timestamps and stale retained plant readings', () => {
  const store = createHydraStore()
  const now = 1000
  store.markConnected(true)
  store.applyMessage('hydra/main/online', 'true', now)
  store.applyMessage('hydra/node1/online', 'true', now)
  store.applyMessage('hydra/node1/soil', '47.3', now)
  store.applyMessage('hydra/node1/status', 'WAIT', now)

  let snapshot = store.snapshot(now)
  assert.equal(snapshot.updatedAt, now)
  assert.equal(snapshot.nodes[0].updatedAt, now)
  assert.equal(snapshot.nodes[0].stale, false)

  snapshot = store.snapshot(now + NODE_STALE_MS + 1)
  assert.equal(snapshot.nodes[0].soilPercent, 47.3)
  assert.equal(snapshot.nodes[0].stale, true)

  store.applyMessage('hydra/main/online', 'false', now + 2)
  snapshot = store.snapshot(now + 2)
  assert.equal(snapshot.nodes[0].stale, true)
})

test('hydra retained snapshots remain stale until a live publication arrives', () => {
  const store = createHydraStore()
  const now = 1000
  store.markConnected(true)
  store.applyMessage('hydra/main/online', 'true', now, { retained: true })
  store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340.0;d=1.23', now, { retained: true })
  store.applyMessage('hydra/node1/online', 'true', now, { retained: true })
  store.applyMessage('hydra/node1/soil', '47.3', now, { retained: true })

  let snapshot = store.snapshot(now)
  assert.equal(snapshot.mainOnline, false)
  assert.equal(snapshot.env.tempC, 24.5)
  assert.equal(snapshot.env.stale, true)
  assert.equal(snapshot.nodes[0].soilPercent, 47.3)
  assert.equal(snapshot.nodes[0].stale, true)

  store.applyMessage('hydra/main/online', 'true', now + 1)
  store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.6;h=61.1;p=1002.5;x=12341.0;d=1.22', now + 1)
  store.applyMessage('hydra/node1/soil', '47.4', now + 1)
  snapshot = store.snapshot(now + 1)
  assert.equal(snapshot.mainOnline, true)
  assert.equal(snapshot.env.stale, false)
  assert.equal(snapshot.nodes[0].stale, false)
})

test('hydra store exposes additive main-node diagnostics', () => {
  const store = createHydraStore()
  const now = 1000
  const diagnostics = {
    firmware: '2.0.0',
    build: 'abc1234',
    boot: 'aabbccddeeff-01234567',
    reset: 'poweron',
    uptime_s: '70',
    last_publish_s: '12',
  }
  for (const [leaf, value] of Object.entries(diagnostics)) {
    assert.equal(store.applyMessage(`hydra/main/diag/${leaf}`, value, now), true)
  }

  const snapshot = store.snapshot(now)
  assert.deepEqual(snapshot.diagnostics, {
    firmware: '2.0.0',
    build: 'abc1234',
    bootId: 'aabbccddeeff-01234567',
    resetReason: 'poweron',
    uptimeSeconds: 70,
    lastPublishSeconds: 12,
    updatedAt: now,
  })
})

test('hydra diagnostics reject malformed or unknown values', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/diag/uptime_s', '-1', now), false)
  assert.equal(store.applyMessage('hydra/main/diag/last_publish_s', 'never', now), true)
  assert.equal(store.applyMessage('hydra/main/diag/password', 'secret', now), false)
  assert.equal(store.snapshot(now).diagnostics.lastPublishSeconds, null)
})

test('hydra atomic environment summary ignores legacy retained topics', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340.0;d=1.23', now), true)
  assert.equal(store.applyMessage('hydra/main/env', 'v=0', now + 1), true)
  assert.equal(store.applyMessage('hydra/main/temp', '30', now + 2), false)
  assert.equal(store.applyMessage('hydra/main/humidity', '80', now + 2), false)
  assert.equal(store.snapshot(now + 2).env, null)
})

test('hydra store rejects foreign topics and malformed payloads', () => {
  const store = createHydraStore()
  const now = 1000
  assert.equal(store.applyMessage('other/main/temp', '24.5', now), false)
  assert.equal(store.applyMessage('hydra/node9/soil', '50', now), false)
  assert.equal(store.applyMessage('hydra/node1/soil', 'junk', now), false)
  assert.equal(store.applyMessage('hydra/node1/pump', 'junk', now), false)
  assert.equal(store.applyMessage('hydra/main/env', 'junk', now), false)
  assert.deepEqual(store.snapshot(now), { configured: true, connected: false, env: null, nodes: [] })
})

test('hydra store clamps soil to the healthy band and reports stale env', () => {
  const store = createHydraStore()
  const now = 1000
  store.applyMessage('hydra/node1/soil', '150', now)
  assert.equal(store.snapshot(now).nodes[0].soilPercent, 100)
  store.applyMessage('hydra/node2/soil', '-3', now)
  assert.equal(store.snapshot(now).nodes[1].soilPercent, 0)

  store.applyMessage('hydra/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340.0;d=1.23', now)
  assert.equal(store.snapshot(now + ENV_STALE_MS - 1).env.stale, false)
  assert.equal(store.snapshot(now + ENV_STALE_MS + 1).env.stale, true)
})

test('hydra source does not purge transitive MQTT modules before loading', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/hydra-mqtt'), 'utf8')
  assert.doesNotMatch(source, /delete loaded\[key\]/)
  assert.doesNotMatch(source, /delete pathCache\[key\]/)
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
  assert.equal(store.applyMessage('hydra/main/env', 'v=1;l=1;t=20;h=50;p=1000;x=100;d=1', now), false)
  assert.equal(store.applyMessage('plants/main/env', 'v=1;l=1;t=20;h=50;p=1000;x=100;d=1', now), true)
  assert.equal(store.applyMessage('plants/node1/soil', '55', now), true)
  assert.equal(store.snapshot(now).env.tempC, 20)
  assert.equal(store.snapshot(now).nodes[0].soilPercent, 55)
})
