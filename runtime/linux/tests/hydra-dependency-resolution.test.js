const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

const filename = path.join(__dirname, '../src/hydra-mqtt.js')
const code = fs.readFileSync(filename, 'utf8')
const symlinkEntry = '/runtime/node_modules/mqtt/build/index.js'
const canonicalEntry = '/runtime/node_modules/.pnpm/mqtt@5.15.2/node_modules/mqtt/build/index.js'

function loadSource() {
  const calls = []
  const errors = []
  const client = new EventEmitter()
  client.subscribe = (topic) => calls.push(['subscribe', topic])
  client.end = (force) => calls.push(['end', force])
  const state = { now: 100000, failure: null }
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
      return client
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
  return { ...context.module.exports, calls, errors, client, state }
}

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
