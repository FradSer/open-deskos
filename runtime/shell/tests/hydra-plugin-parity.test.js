'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { createHydraSource } = require('../src/hydra-mqtt')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createShellDeskData } = require('../src/desk-data')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { healthPort } = require('../src/plugins/health')
const run = promisify(execFile)
const { install } = require('./helpers/hydra-selection')
const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
const directory = path.join(__dirname, 'fixtures/hydra-replacement')
const timestamp = 1700000000000

async function fixture(t, replacement, configured = true, savedEnvironment) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-parity-'))
  let host
  const clients = []
  let autoEnd = true
  t.after(async () => {
    autoEnd = true
    for (const client of clients) client.done?.()
    try { await host?.stop() } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
  const env = savedEnvironment || { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  let replacements = []
  let native
  if (replacement === 'signed') {
    native = await install(root, env)
    replacements = await native.load()
    native.mutate()
  } else if (replacement) {
    await run(process.execPath, [cli, 'link', directory, '--trust', '--replace', '--grant', 'source.hydra', '--grant', 'ipc'], { env })
  }
  if (!native) replacements = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
  assert.equal(replacements.length, replacement ? 1 : 0)
  let time = timestamp
  let failure = false
  let attempts = 0
  let updates = 0
  let defaults = 0
  const settings = { url: configured ? 'mqtt://controlled' : '', topicPrefix: 'plants/ignored', now: () => time, onUpdate: () => updates++,
    connectImpl(url, options) {
      attempts++
      assert.equal(url, 'mqtt://controlled')
      assert.equal(options.reconnectPeriod, 5000)
      assert.equal(options.connectTimeout, 10000)
      assert.match(options.clientId, /^open-deskos-shell-/)
      if (failure) throw Error('controlled connection failure')
      const client = new EventEmitter()
      client.topics = []
      client.ends = 0
      client.subscribe = topic => client.topics.push(topic)
      client.end = (force, callback) => { assert.equal(force, true); client.ends++; client.done = callback; if (autoEnd) callback() }
      clients.push(client)
      return client
    },
  }
  const handlers = new Map()
  host = createPluginHost({ capabilities: {
    ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
    'source.hydra': { connect: settings.connectImpl, options: { ...settings, connectImpl: undefined }, create(options) { assert.equal(replacement, false); defaults++; return createHydraSource({ ...options, connectImpl: settings.connectImpl }) } },
    'desk.data': { create: createShellDeskData, smokeMode: true },
  } })
  createMainPlugins({ replacementPlugins: replacements }).filter(plugin => ['odk.source.hydra', 'odk.system.desk-data'].includes(plugin.manifest.id))
    .forEach(plugin => host.register(plugin))
  await host.start()
  if (native) {
    assert.equal(host.get(DATA_PORTS.hydra).fixtureRevision, '2.0.0')
    assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.source.hydra').manifest.version, '2.0.0')
  }
  return { host, clients, handlers, env, defaults: () => defaults, attempts: () => attempts, updates: () => updates,
    advance: value => { time += value }, fail: value => { failure = value }, pendingEnd: () => { autoEnd = false },
    ipc: () => handlers.get('odk-hydra-status')(null),
    read: () => host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' }),
    health: () => host.get(healthPort('odk.source.hydra')).snapshot(),
    publish(topic, value, retain = false) { clients.at(-1).emit('message', topic, Buffer.from(value), { retain }) },
  }
}

for (const replacement of [false, true, 'signed']) {
  const name = replacement === 'signed' ? 'independently signed Hydra' : replacement ? 'independently linked Hydra' : 'default Hydra'
  test(`${name} preserves retained/live MQTT, IPC, readings, and stale boundaries`, async t => {
    const f = await fixture(t, replacement)
    assert.equal((await f.read()).reading.state, 'unavailable')
    const client = f.clients[0]
    client.emit('connect')
    assert.deepEqual(client.topics, ['plants/#'])
    f.publish('plants/main/online', 'true', true)
    f.publish('plants/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340;d=1.23', true)
    f.publish('plants/node1/soil', '42', true)
    assert.equal(f.ipc().mainOnline, false)
    assert.equal((await f.read()).reading.state, 'stale')
    f.publish('plants/main/online', 'true')
    f.publish('plants/main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340;d=1.23')
    f.publish('plants/node1/soil', '42')
    f.publish('plants/node1/online', 'true')
    f.publish('plants/node1/status', 'PULSE')
    f.publish('plants/main/diag/firmware', 'controlled')
    assert.deepEqual(f.ipc().diagnostics, { firmware: 'controlled', updatedAt: timestamp })
    const reading = (await f.read()).reading
    assert.equal(reading.state, 'live')
    assert.equal(reading.id, 'odk.tile.hydra')
    assert.deepEqual(reading.value, { asOf: new Date(timestamp).toISOString(), gatewayOnline: true,
      greenhouse: { temperatureC: 24.5, humidityPercent: 61.2, pressureHpa: 1002.6, lightLux: 12340, stale: false, measuredAt: new Date(timestamp).toISOString() },
      plants: [{ id: 1, name: 'Plant 1', soilPercent: 42, watering: true, online: true, stale: false, measuredAt: new Date(timestamp).toISOString() }] })
    assert.equal(f.health().state, 'healthy')
    const count = f.updates()
    for (const [topic, value] of [['hydra/node1/soil', '99'], ['plants/node9/soil', '99'], ['plants/main/env', 'bad'], ['plants/main/temp', '99']]) f.publish(topic, value)
    assert.equal(f.updates(), count)
    assert.equal(f.ipc().nodes[0].soilPercent, 42)
    f.advance(180000)
    assert.equal(f.ipc().mainOnline, true)
    f.advance(1)
    assert.equal(f.ipc().mainOnline, false)
    assert.equal(f.ipc().nodes[0].stale, true)
    f.advance(119999)
    assert.equal(f.ipc().env.stale, false)
    f.advance(1)
    assert.equal((await f.read()).reading.state, 'stale')
    assert.equal(f.health().state, 'degraded')
    client.emit('close')
    assert.equal((await f.read()).reading.value, null)
    assert.equal(f.health().state, 'failed')
  })

  test(`${name} preserves complete protocol transitions against the baseline`, async t => {
    const baseline = await fixture(t, false)
    const candidate = await fixture(t, replacement)
    for (const f of [baseline, candidate]) f.clients[0].emit('connect')
    const events = [
      ['main/online', 'true', true], ['main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340;d=1.23', true],
      ['node6/soil', '150', true], ['node1/soil', '-3'], ['node2/soil', 'NC'],
      ['node3/soil', '47.3suffix'], ['node4/pump', 'true'], ['node4/status', 'IDLE'],
      ...['IDLE', 'PULSE', 'SOAK', 'WATER', 'PAUSE', 'WAIT', 'DORM', 'FAULT'].map(value => ['node5/status', value]),
      ['node6/online', 'true'], ['node6/soil', '53'], ['node6/soil', '54', true],
      ['main/online', 'true'], ['main/env', 'v=1;l=0;t=20;h=50;p=1000'],
      ['main/env', 'v=1;l=1;t=20;h=50;p=1000;x=3;d=junk'], ['main/env', 'v=1;l=1;t=20;h=50;p=1000;x=junk'],
      ['main/env', 'v=1;l=2;t=20;h=50;p=1000'], ['main/env', 'v=0'],
      ['main/temp', '30'], ['main/env', 'v=1;l=1;t=24;h=61;p=1002;x=12340;d=1'],
      ...Object.entries({ firmware: '2.0.0', build: 'abcdef', boot: 'boot-id', reset: 'poweron',
        uptime_s: '70', last_publish_s: 'never' }).map(([leaf, value]) => [`main/diag/${leaf}`, value]),
      ['main/diag/firmware', 'x'.repeat(64)], ['main/diag/build', ''], ['main/diag/uptime_s', '-1'],
      ['main/diag/last_publish_s', '12'], ['main/diag/unknown', 'ignored'],
      ['node0/soil', '20'], ['node7/soil', '20'], ['node1/soil', 'junk'], ['node1/pump', 'junk'],
      ['node1/status', 'unknown'], ['node1/online', 'false'], ['main/online', 'false'], ['main/online', 'true'],
    ]
    async function compare(label) {
      assert.deepEqual(candidate.ipc(), baseline.ipc(), label)
      assert.deepEqual(await candidate.read(), await baseline.read(), label)
      assert.deepEqual(candidate.health(), baseline.health(), label)
      assert.equal(candidate.updates(), baseline.updates(), label)
    }
    for (const [topic, value, retained = false] of events) {
      for (const f of [baseline, candidate]) f.publish(`plants/${topic}`, value, retained)
      await compare(topic)
    }
    for (const delta of [180000, 1, 119999, 1]) {
      baseline.advance(delta); candidate.advance(delta)
      await compare(`stale boundary ${delta}`)
    }
    for (const event of ['reconnect', 'connect', 'close']) {
      for (const f of [baseline, candidate]) f.clients[0].emit(event)
      await compare(event)
    }
  })

  test(`${name} preserves connection retries, release ordering, and unavailable configuration`, async t => {
    const f = await fixture(t, replacement)
    f.pendingEnd()
    const old = f.host.get(DATA_PORTS.hydra)
    const disable = f.host.setEnabled('odk.source.hydra', false)
    let enabled = false
    f.fail(true)
    const enable = f.host.setEnabled('odk.source.hydra', true).then(() => { enabled = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(enabled, false)
    assert.equal(f.clients.length, 1)
    const before = f.updates()
    f.publish('plants/node1/soil', '99')
    assert.equal(f.updates(), before)
    f.clients[0].done()
    await Promise.all([disable, enable])
    assert.notEqual(f.host.get(DATA_PORTS.hydra), old)
    assert.equal(f.attempts(), 2)
    f.fail(false)
    f.advance(29999)
    f.ipc()
    assert.equal(f.attempts(), 2)
    f.advance(1)
    assert.equal(f.health().state, 'failed')
    assert.equal(f.attempts(), 2, 'health must not initiate connection work')
    f.ipc()
    assert.equal(f.attempts(), 3)
    const missing = await fixture(t, replacement, false)
    assert.equal(missing.attempts(), 0)
    assert.deepEqual(missing.ipc(), { configured: false, connected: false, env: null, nodes: [] })
    assert.equal((await missing.read()).reading.state, 'unconfigured')
    assert.equal(missing.health().state, 'degraded')
  })

  test(`${name} retains uncertain MQTT release without another client`, async t => {
    const f = await fixture(t, replacement)
    f.pendingEnd()
    const disable = f.host.setEnabled('odk.source.hydra', false)
    await new Promise(resolve => setImmediate(resolve))
    f.clients[0].done(Error('controlled release failure'))
    await disable
    await f.host.setEnabled('odk.source.hydra', true)
    assert.equal(f.clients.length, 1)
    assert.equal(f.clients[0].ends, 1)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.source.hydra').state, 'cleanup-failed')
  })
}

test('removing Hydra development link restores the default factory', async t => {
  const f = await fixture(t, true, false)
  const entry = path.join(directory, 'entry.cjs')
  const bytes = fs.readFileSync(entry)
  await f.host.stop()
  await run(process.execPath, [cli, 'remove', 'odk.source.hydra'], { env: f.env })
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.deepEqual(fs.readFileSync(entry), bytes)
  const restored = await fixture(t, false, false, f.env)
  assert.equal(restored.defaults(), 1)
  assert.equal(restored.ipc().configured, false)
})

// Independent source acceptance must not execute the baseline parser or projection.
test('Hydra replacement has no default implementation imports', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(directory, 'entry.cjs'), 'utf8'), /require\s*\(/)
})

test('Hydra signed fixture refuses a state directory outside its owned root', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-isolation-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  await assert.rejects(install(root, { ...process.env, XDG_STATE_HOME: path.dirname(root), LOCALAPPDATA: path.dirname(root) }),
    /parent-owned isolated state/)
  assert.deepEqual(fs.readdirSync(root), [])
})
