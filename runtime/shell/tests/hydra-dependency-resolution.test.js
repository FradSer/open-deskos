const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { DATA_PORTS } = require('../src/plugins/data-sources')

const filename = path.join(__dirname, '../src/hydra-mqtt.js')
const code = fs.readFileSync(filename, 'utf8')
const symlinkEntry = '/runtime/node_modules/mqtt/build/index.js'
const canonicalEntry = '/runtime/node_modules/.pnpm/mqtt@5.15.2/node_modules/mqtt/build/index.js'

function loadSource({ autoEnd = true } = {}) {
  const calls = []
  const errors = []
  const endings = []
  const state = { now: 100000, failure: null, autoEnd }
  function createClient() {
    const client = new EventEmitter()
    client.subscribe = topic => calls.push(['subscribe', topic])
    client.end = (force, callback) => {
      calls.push(['end', force])
      if (state.autoEnd) callback?.()
      else endings.push(callback)
    }
    return client
  }
  const client = createClient()
  const clients = []
  function record(stage, value) {
    calls.push([stage, value])
    if (state.failure === stage) throw new Error(`${stage} unavailable`)
  }
  function fakeRequire(id) {
    if (id === 'node:fs') {
      return { realpathSync(entry) {
        record('canonicalization', entry)
        assert.equal(entry, symlinkEntry)
        return canonicalEntry
      } }
    }
    record('loading', id)
    if (id !== canonicalEntry) throw new Error('Cannot find module mqtt-packet')
    return { connect(url) {
      calls.push(['connect', url])
      const next = clients.length ? createClient() : client
      clients.push(next)
      return next
    } }
  }
  fakeRequire.resolve = (id) => {
    record('resolution', id)
    assert.equal(id, 'mqtt')
    return symlinkEntry
  }
  const context = {
    module: { exports: {} }, require: fakeRequire, process: { pid: 42 },
    Date: { now: () => state.now }, console: { error: (message) => errors.push(message) },
  }
  vm.runInNewContext(code, context, { filename })
  return { ...context.module.exports, calls, errors, client, clients, state, endings }
}

for (const failed of [false, true]) {
  test(`Hydra plugin ${failed ? 'retains failed MQTT release' : 'waits for MQTT release'} before replacement`, async t => {
    const fixture = loadSource({ autoEnd: false })
    const instances = []
    const handlers = new Map()
    const host = createPluginHost({ capabilities: {
      ipc: { handle: (name, callback) => handlers.set(name, callback), removeHandler: name => handlers.delete(name) },
      'source.hydra': { options: { url: 'mqtt://broker.example' }, create(options) {
        const source = fixture.createHydraSource(options)
        instances.push(source)
        return source
      } },
    } })
    t.after(async () => {
      fixture.state.autoEnd = true
      for (const done of fixture.endings) done?.()
      await host.stop()
    })
    host.register(createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.hydra'))
    await host.start()
    const original = host.get(DATA_PORTS.hydra)
    const disable = host.setEnabled('odk.source.hydra', false)
    let enabled = false
    const enable = host.setEnabled('odk.source.hydra', true).then(() => { enabled = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(enabled, false)
    assert.equal(instances.length, 1)
    fixture.endings[0](failed ? Error('controlled release failure') : undefined)
    await Promise.all([disable, enable])
    if (failed) {
      assert.equal(instances.length, 1)
      assert.equal(host.get(DATA_PORTS.hydra), null)
      assert.equal(host.list()[0].state, 'cleanup-failed')
      assert.equal(handlers.size, 0)
      await host.setEnabled('odk.source.hydra', true)
      assert.equal(instances.length, 1)
      assert.equal(fixture.calls.filter(([name]) => name === 'end').length, 1)
      return
    }
    assert.equal(instances.length, 2)
    assert.notEqual(host.get(DATA_PORTS.hydra), original)
    assert.notEqual(fixture.clients[0], fixture.clients[1])
    assert.deepEqual([...handlers.keys()].sort(), ['odk-hydra-device', 'odk-hydra-status'])
  })
}

test('Hydra shutdown waits for MQTT completion and ignores late events', async () => {
  const fixture = loadSource({ autoEnd: false })
  let updates = 0
  const source = fixture.createHydraSource({ url: 'mqtt://broker.example', onUpdate: () => updates++ })
  fixture.client.emit('connect')
  fixture.client.emit('message', 'hydra/node1/soil', Buffer.from('42'), {})
  const before = structuredClone(source.snapshot())
  const calls = fixture.calls.length
  let complete = false
  const pending = Promise.resolve(source.stop()).then(() => { complete = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(complete, false)
  assert.equal(fixture.endings.length, 1)
  const count = updates
  fixture.client.emit('message', 'hydra/node1/soil', Buffer.from('99'), {})
  fixture.client.emit('connect')
  fixture.client.emit('reconnect')
  fixture.client.emit('close')
  assert.deepEqual(structuredClone(source.snapshot()), before)
  assert.equal(updates, count)
  assert.equal(fixture.calls.length, calls + 1, 'late connect must not subscribe again')
  assert.equal(source.stop(), source.stop(), 'concurrent stop calls share ownership')
  fixture.endings[0]()
  await pending
  await source.stop()
  assert.equal(fixture.calls.length, calls + 1)
})

for (const synchronous of [false, true]) {
  test(`Hydra ${synchronous ? 'throwing' : 'callback'} shutdown failures retain uncertain client ownership`, async () => {
    const fixture = loadSource({ autoEnd: false })
    const source = fixture.createHydraSource({ url: 'mqtt://broker.example' })
    const end = fixture.client.end
    if (synchronous) fixture.client.end = force => {
      fixture.calls.push(['end', force])
      throw Error('controlled shutdown failure')
    }
    const first = source.stop()
    if (!synchronous) {
      assert.equal(typeof fixture.endings[0], 'function')
      fixture.endings[0](Error('controlled shutdown failure'))
    }
    await assert.rejects(first, /controlled shutdown failure/)
    fixture.client.end = end
    const second = source.stop()
    assert.equal(second, first)
    await assert.rejects(second, /controlled shutdown failure/)
    assert.equal(fixture.calls.filter(([name]) => name === 'end').length, 1)
    source.snapshot()
    assert.equal(fixture.calls.filter(([name]) => name === 'connect').length, 1)
  })
}

test('Hydra cannot treat the actual MQTT end shortcut as successful cleanup', async () => {
  const { MqttClient } = require(fs.realpathSync(require.resolve('mqtt')))
  const fixture = loadSource()
  let cleanups = 0
  Object.assign(fixture.client, {
    log() {}, options: { clientId: 'controlled', reconnectPeriod: 5000 }, outgoing: {},
    _clearReconnect() {}, _cleanUp() { cleanups++; throw Error('controlled transport cleanup failure') },
    end: MqttClient.prototype.end,
  })
  const source = fixture.createHydraSource({ url: 'mqtt://broker.example' })
  await assert.rejects(source.stop(), /controlled transport cleanup failure/)
  assert.equal(fixture.client.disconnecting, true)
  await assert.rejects(source.stop(), /controlled transport cleanup failure/)
  assert.equal(cleanups, 1)
  assert.equal(fixture.client.disconnected, undefined)
})

test('Hydra loads the canonical MQTT entry and receives live readings', () => {
  const fixture = loadSource()
  const source = fixture.createHydraSource({ url: 'mqtt://broker.example' })
  assert.deepEqual(fixture.calls.slice(0, 4), [
    ['resolution', 'mqtt'], ['canonicalization', symlinkEntry],
    ['loading', canonicalEntry], ['connect', 'mqtt://broker.example'],
  ])
  fixture.client.emit('connect')
  fixture.client.emit('message', 'hydra/node1/soil', Buffer.from('62.4'), { retain: false })
  const snapshot = source.snapshot()
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.nodes[0].soilPercent, 62.4)
  assert.equal(snapshot.nodes[0].stale, false)
  assert.deepEqual(fixture.calls.at(-1), ['subscribe', 'hydra/#'])
  assert.deepEqual(fixture.errors, [])
  source.stop()
  assert.deepEqual(fixture.calls.at(-1), ['end', true])
})

for (const stage of ['resolution', 'canonicalization', 'loading']) {
  test(`Hydra contains ${stage} failure and retries after 30 seconds`, () => {
    const fixture = loadSource()
    fixture.state.failure = stage
    const source = fixture.createHydraSource({ url: 'mqtt://broker.example' })
    assert.equal(source.snapshot().connected, false)
    assert.equal(fixture.errors.length, 1)
    assert.match(fixture.errors[0], new RegExp(`hydra mqtt unavailable, retrying: ${stage} unavailable`))
    const attempts = fixture.calls.length
    fixture.state.failure = null
    fixture.state.now += 29999
    assert.equal(source.snapshot().connected, false)
    assert.equal(fixture.calls.length, attempts)
    fixture.state.now += 1
    source.snapshot()
    assert.deepEqual(fixture.calls.at(-1), ['connect', 'mqtt://broker.example'])
    fixture.client.emit('connect')
    assert.equal(source.snapshot().connected, true)
    assert.equal(fixture.errors.length, 1)
    source.stop()
  })
}

test('unconfigured Hydra does not resolve or load MQTT', () => {
  const fixture = loadSource()
  const source = fixture.createHydraSource()
  assert.equal(source.snapshot().configured, false)
  source.stop()
  assert.deepEqual(fixture.calls, [])
  assert.deepEqual(fixture.errors, [])
})


test('public Hydra connector uses canonical MQTT loading without source construction', () => {
  const fixture = loadSource()
  assert.equal(typeof fixture.connectHydraMqtt, 'function')
  assert.deepEqual(fixture.calls, [])
  assert.equal(fixture.connectHydraMqtt('mqtt://broker.example', { reconnectPeriod: 5000 }), fixture.client)
  assert.deepEqual(fixture.calls, [ ['resolution', 'mqtt'], ['canonicalization', symlinkEntry],
    ['loading', canonicalEntry], ['connect', 'mqtt://broker.example'] ])
})
