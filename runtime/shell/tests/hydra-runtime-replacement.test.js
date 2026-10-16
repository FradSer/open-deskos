'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createHydraSource } = require('../src/hydra-mqtt')
const { createShellOdkData } = require('../src/odk-data')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { healthPort } = require('../src/plugins/health')
const { install } = require('./helpers/hydra-selection')

const id = 'odk.source.hydra'
const deferred = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}

test('runtime Host replaces signed Hydra factories only after old MQTT ownership releases', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-runtime-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const clients = []
  const handlers = new Map()
  let host
  let allowDefault = false
  let defaults = 0
  let automaticRelease = false
  const options = { url: 'mqtt://controlled', topicPrefix: 'plants/ignored', now: () => 1700000000000 }
  const connect = () => {
    const client = new EventEmitter()
    client.releasing = deferred()
    client.subscriptions = []
    client.subscribe = topic => client.subscriptions.push(topic)
    client.end = (force, done) => {
      assert.equal(force, true)
      client.done = done
      client.releasing.resolve()
      if (automaticRelease) done()
    }
    clients.push(client)
    return client
  }
  const consumers = async () => ({
    ipc: handlers.get('odk-hydra-status')(null),
    reading: await host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' }),
    health: host.get(healthPort(id)).snapshot(),
  })
  const publish = client => {
    client.emit('connect')
    for (const [topic, payload] of [['main/online', 'true'],
      ['main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340;d=1.23'],
      ['node1/soil', '42'], ['node1/online', 'true'], ['node1/status', 'PULSE']]) {
      client.emit('message', `plants/${topic}`, Buffer.from(payload), { retain: false })
    }
    assert.deepEqual(client.subscriptions, ['plants/#'])
  }
  try {
    const native = await install(root, env, { signal: t.signal })
    const first = native.config().plugins[id].native.revision
    const firstBytes = [...(await native.store.snapshot(first)).files]
    const [signed] = await native.load()
    host = createPluginHost({ capabilities: {
      ipc: { handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler) },
        removeHandler: channel => handlers.delete(channel) },
      'source.hydra': { options, connect, create(configuration) {
        assert.equal(allowDefault, true, 'Runtime signed replacement must not construct the default source')
        defaults++
        return createHydraSource({ ...configuration, connectImpl: connect })
      } },
      'desk.data': { create: createShellOdkData, smokeMode: true },
    } })
    const plugins = createMainPlugins({ replacementPlugins: [signed] })
    plugins.filter(plugin => [id, 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
    await host.start()
    const originalOdkData = host.get(DESK_PORTS.data)
    publish(clients[0])
    const baseline = await consumers()
    assert.equal(baseline.ipc.env.tempC, 24.5)
    assert.equal(baseline.ipc.nodes[0].pump, true)
    assert.equal(host.get(DATA_PORTS.hydra).fixtureRevision, '2.0.0')
    await native.command(['update', id, native.bundle('3.0.0'), '--keyring', native.keyring, '--trust', '--grant', 'source.hydra', '--grant', 'ipc'])
    const second = native.config().plugins[id].native.revision
    const secondBytes = [...(await native.store.snapshot(second)).files]
    const [updated] = await native.load()
    assert.equal(host.get(DATA_PORTS.hydra).fixtureRevision, '2.0.0')
    const replacement = host.replace(updated)
    await clients[0].releasing.promise
    assert.equal(clients.length, 1)
    assert.equal(handlers.has('odk-hydra-status'), false)
    assert.equal(host.get(DATA_PORTS.hydra), null)
    clients[0].emit('message', 'plants/node1/soil', Buffer.from('99'), { retain: false })
    clients[0].done()
    await replacement
    assert.equal(clients.length, 2)
    assert.equal(host.get(DATA_PORTS.hydra).fixtureRevision, '3.0.0')
    assert.notEqual(host.get(DESK_PORTS.data), originalOdkData)
    publish(clients[1])
    assert.deepEqual(await consumers(), baseline)
    await native.command(['remove', id])
    allowDefault = true
    const defaultPlugin = createMainPlugins().find(plugin => plugin.manifest.id === id)
    const restored = host.replace(defaultPlugin)
    await clients[1].releasing.promise
    assert.equal(clients.length, 2)
    clients[1].done()
    await restored
    publish(clients[2])
    assert.deepEqual(await consumers(), baseline)
    assert.equal(defaults, 1)
    assert.deepEqual([...(await native.store.snapshot(first)).files], firstBytes)
    assert.deepEqual([...(await native.store.snapshot(second)).files], secondBytes)
  } finally {
    automaticRelease = true
    for (const client of clients) client.done?.()
    try { await host?.stop() } finally { await fs.rm(root, { recursive: true, force: true }) }
  }
  assert.equal(handlers.size, 0)
})
