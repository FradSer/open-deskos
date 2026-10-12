'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { createRequire } = require('node:module')
const { EventEmitter } = require('node:events')
const sdkRequire = createRequire(fs.realpathSync(require.resolve('mqtt')))
const packets = sdkRequire('mqtt-packet')
const { createHydraSource, connectHydraMqtt } = require('../src/hydra-mqtt')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { createShellOdkData } = require('../src/odk-data')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { install } = require('./helpers/hydra-selection')
const { wait, cleanup, runCommand: run } = require('./helpers/hydra-wire-lifecycle')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

async function endpoint() {
  const subscribed = deferred(), closed = deferred()
  const errors = []
  const connections = new Set()
  const received = []
  let peer
  const server = net.createServer(socket => {
    connections.add(socket)
    peer = socket
    const parser = packets.parser()
    const fail = error => { errors.push(error); subscribed.reject(error); socket.destroy() }
    parser.on('error', fail)
    socket.on('error', fail)
    socket.once('close', () => { connections.delete(socket); closed.resolve() })
    socket.on('data', bytes => parser.parse(bytes))
    parser.on('packet', packet => {
      received.push(packet)
      try {
        if (packet.cmd === 'connect') socket.write(packets.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }))
        else if (packet.cmd === 'subscribe') {
          socket.write(packets.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0) }))
          subscribed.resolve(packet)
        } else if (packet.cmd === 'pingreq') socket.write(packets.generate({ cmd: 'pingresp' }))
        else if (packet.cmd === 'disconnect') socket.end()
      } catch (error) { fail(error) }
    })
  })
  const listening = deferred()
  server.once('error', listening.reject)
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  return { url: `mqtt://127.0.0.1:${server.address().port}`, subscribed, closed, received, errors,
    publish(topic, payload, retain) { peer.write(packets.generate({ cmd: 'publish', topic, payload, retain, qos: 0, dup: false })) },
    async stop() {
      for (const socket of connections) socket.destroy()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      assert.equal(connections.size, 0)
      assert.equal(server.listening, false)
    },
  }
}

for (const kind of ['default', 'linked', 'signed']) {
  test(`${kind} Hydra uses real canonical MQTT SDK traffic and releases its connection`, { timeout: 15000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-wire-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
    let broker, host
    try {
      let replacements = []
      if (kind === 'signed') {
        const native = await install(root, env, { signal: t.signal })
        replacements = await native.load()
        native.mutate()
      } else if (kind === 'linked') {
        await run(process.execPath, [path.join(__dirname, '../scripts/odk-plugin-cli.js'), 'link',
          path.join(__dirname, 'fixtures/hydra-replacement'), '--replace', '--trust', '--grant', 'source.hydra', '--grant', 'ipc'], { env, signal: t.signal })
        replacements = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
      }
      broker = await endpoint()
      const handlers = new Map(), updates = new EventEmitter()
      let published = 0, defaults = 0
      const options = { url: broker.url, topicPrefix: 'plants/ignored', now: () => 1700000000000,
        onUpdate() { published++; updates.emit('update') } }
      host = createPluginHost({ capabilities: {
        ipc: { handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler) },
          removeHandler: channel => handlers.delete(channel) },
        'source.hydra': { options, connect: connectHydraMqtt, create(configuration) {
          assert.equal(kind, 'default', 'Independent sources must not construct the default')
          defaults++
          return createHydraSource(configuration)
        } },
        'desk.data': { create: createShellOdkData, smokeMode: true },
      } })
      createMainPlugins({ replacementPlugins: replacements })
        .filter(plugin => ['odk.source.hydra', 'odk.system.data'].includes(plugin.manifest.id))
        .forEach(plugin => host.register(plugin))
      await host.start()
      const source = host.get(DATA_PORTS.hydra)
      assert.equal(source.fixtureRevision, kind === 'signed' ? '2.0.0' : undefined)
      assert.equal(defaults, kind === 'default' ? 1 : 0)
      const subscription = await wait(broker.subscribed.promise, t.signal)
      assert.deepEqual(subscription.subscriptions.map(({ topic, qos }) => ({ topic, qos })), [{ topic: 'plants/#', qos: 0 }])
      const connect = broker.received.find(packet => packet.cmd === 'connect')
      assert.equal(connect.protocolVersion, 4)
      assert.match(connect.clientId, /^odk-shell-/)
      assert.equal(connect.username, undefined)
      assert.equal(connect.password, undefined)
      const read = async () => (await host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' })).reading
      const health = () => host.get('odk:plugin-health/odk.source.hydra/v1').snapshot()
      const send = async retain => {
        const messages = [['main/online', 'true'], ['main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340;d=1.23'],
          ['node1/soil', '42'], ['node1/online', 'true'], ['node1/status', 'PULSE']]
        const target = published + messages.length
        const applied = deferred()
        const check = () => { if (published === target) { updates.removeListener('update', check); applied.resolve() } }
        updates.on('update', check)
        for (const [topic, value] of messages) broker.publish(`plants/${topic}`, value, retain)
        await wait(applied.promise, t.signal)
      }
      await send(true)
      assert.equal((await read()).state, 'stale')
      assert.equal(health().state, 'degraded')
      assert.equal(handlers.get('odk-hydra-status')(null).mainOnline, false)
      await send(false)
      const reading = await read()
      assert.equal(reading.state, 'live')
      assert.equal(reading.value.greenhouse.temperatureC, 24.5)
      assert.equal(reading.value.greenhouse.lightLux, 12340)
      assert.deepEqual(reading.value.plants, [{ id: 1, name: 'Plant 1', soilPercent: 42,
        watering: true, online: true, stale: false, measuredAt: new Date(1700000000000).toISOString() }])
      assert.equal(health().state, 'healthy')
      const before = published
      const cached = source.cachedSnapshot
      let cachedReads = 0
      source.snapshot = () => { throw Error('Health must not use an ordinary snapshot') }
      source.cachedSnapshot = (...args) => { cachedReads++; return cached(...args) }
      health(); health()
      assert.equal(cachedReads, 2)
      assert.equal(published, before)
      assert.equal(broker.received.filter(packet => packet.cmd === 'connect').length, 1)
      await wait(host.stop(), t.signal)
      assert.equal(handlers.size, 0)
      await wait(broker.closed.promise, t.signal)
      assert.equal(broker.errors.length, 0)
    } finally { await cleanup(host, broker, root, t.signal) }
  })
}
