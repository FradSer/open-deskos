'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { EventEmitter } = require('node:events')
const { install } = require('./helpers/hydra-selection')
const { createHydraSource } = require('../src/hydra-mqtt')
const { createShellDeskData } = require('../src/desk-data')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { resolveConfigPath, updateConfig } = require('../src/plugin-config')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const id = 'odk.source.hydra'
const health = 'odk:plugin-health/odk.source.hydra/v1'
const time = 1700000000000

for (const mode of ['live', 'stale', 'unavailable', 'unconfigured']) {
  test(`signed Hydra ${mode} consumers survive update rollback and removal`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-revisions-'))
    const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
    const clients = []
    let active
    let calls = 0
    const options = { url: mode === 'unconfigured' ? '' : 'mqtt://controlled', topicPrefix: 'plants/ignored', now: () => time,
      connectImpl(url, configuration) {
        assert.ok(clients.every(client => client.closed), 'A new source must wait for all previous client releases')
        assert.equal(url, 'mqtt://controlled')
        assert.equal(configuration.reconnectPeriod, 5000)
        assert.equal(configuration.connectTimeout, 10000)
        calls++
        const client = new EventEmitter()
        client.closed = false
        client.ends = 0
        client.topics = []
        client.subscribe = topic => client.topics.push(topic)
        client.end = (force, done) => { assert.equal(force, true); client.ends++; client.closed = true; done() }
        clients.push(client)
        return client
      },
    }
    try {
      const native = await install(root, env)
      updateConfig(resolveConfigPath(env), config => ({ ...config, plugins: { ...config.plugins,
        [id]: { ...config.plugins[id], enabled: true }, 'odk.tile.clock': { enabled: false } } }))
      const peer = structuredClone(native.config().plugins['odk.tile.clock'])
      const consumers = async () => ({ ipc: active.handlers.get('odk-hydra-status')(null),
        reading: await active.host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' }),
        health: active.host.get(health).snapshot() })
      const open = async version => {
        const replacements = await native.load()
        assert.equal(replacements.length, version === '1.0.0' ? 0 : 1)
        const handlers = new Map()
        let defaults = 0
        const host = createPluginHost({ capabilities: {
          ipc: { handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler) },
            removeHandler: channel => handlers.delete(channel) },
          'source.hydra': { connect: options.connectImpl, options: { ...options, connectImpl: undefined }, create(configuration) {
            assert.equal(version, '1.0.0', 'Signed Hydra must not construct the default source')
            defaults++
            return createHydraSource({ ...configuration, connectImpl: options.connectImpl })
          } },
          'desk.data': { create: createShellDeskData, smokeMode: true },
        } })
        active = { host, handlers }
        createMainPlugins({ replacementPlugins: replacements })
          .filter(plugin => [id, 'odk.system.desk-data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
        await host.start()
        assert.equal(host.list().find(plugin => plugin.manifest.id === id).manifest.version, version)
        assert.equal(host.get(DATA_PORTS.hydra).fixtureRevision, version === '1.0.0' ? undefined : version)
        assert.equal(defaults, version === '1.0.0' ? 1 : 0)
        if (mode === 'live' || mode === 'stale') {
          const client = clients.at(-1)
          client.emit('connect')
          assert.deepEqual(client.topics, ['plants/#'])
          for (const [topic, value] of [['main/online', 'true'], ['main/env', 'v=1;l=1;t=24;h=61;p=1002;x=12340;d=1'],
            ['node1/soil', '42'], ['node1/online', 'true'], ['node1/status', 'PULSE']]) {
            client.emit('message', `plants/${topic}`, Buffer.from(value), { retain: mode === 'stale' })
          }
        }
      }
      const restart = async version => {
        const previous = active.host.get(DATA_PORTS.hydra)
        const snapshot = previous.snapshot()
        await active.host.stop()
        assert.equal(active.handlers.size, 0)
        for (const client of clients) {
          assert.equal(client.closed, true)
          assert.equal(client.ends, 1)
          client.emit('message', 'plants/node1/soil', Buffer.from('99'), { retain: false })
        }
        assert.deepEqual(previous.snapshot(), snapshot, 'Released sources ignore late publications and cannot reconnect')
        await open(version)
        assert.deepEqual(await consumers(), baseline)
        assert.equal(native.config().plugins[id].enabled, true)
        assert.deepEqual(native.config().plugins['odk.tile.clock'], peer)
      }
      await open('2.0.0')
      const baseline = await consumers()
      assert.equal(baseline.reading.reading.state, mode)
      assert.equal(baseline.health.state, { live: 'healthy', stale: 'degraded', unavailable: 'failed', unconfigured: 'degraded' }[mode])
      const first = native.config().plugins[id].native.revision
      const firstSnapshot = await native.store.snapshot(first)
      const bundle = native.bundle('3.0.0')
      let running = active.host.get(DATA_PORTS.hydra)
      assert.equal(JSON.parse((await native.command(['update', id, bundle, '--keyring', native.keyring,
        '--trust', '--grant', 'source.hydra', '--grant', 'ipc'])).stdout).effect, 'selection-only')
      const second = native.config().plugins[id].native.revision
      assert.notEqual(first, second)
      const secondSnapshot = await native.store.snapshot(second)
      assert.equal(active.host.get(DATA_PORTS.hydra), running)
      assert.deepEqual(await consumers(), baseline)
      await restart('3.0.0')
      running = active.host.get(DATA_PORTS.hydra)
      const bytes = fs.readFileSync(resolveConfigPath(env))
      fs.appendFileSync(path.join(bundle, 'entry.cjs'), '\nthrow Error("Unsigned Hydra update")')
      await assert.rejects(native.command(['update', id, bundle, '--keyring', native.keyring,
        '--trust', '--grant', 'source.hydra', '--grant', 'ipc']), /native file hash mismatch/)
      assert.deepEqual(fs.readFileSync(resolveConfigPath(env)), bytes)
      assert.equal(active.host.get(DATA_PORTS.hydra), running)
      assert.deepEqual(await consumers(), baseline)
      assert.equal(JSON.parse((await native.command(['rollback', id, '--keyring', native.keyring])).stdout).effect, 'selection-only')
      assert.equal(native.config().plugins[id].native.revision, first)
      assert.equal(active.host.get(DATA_PORTS.hydra), running)
      await restart('2.0.0')
      running = active.host.get(DATA_PORTS.hydra)
      assert.equal(JSON.parse((await native.command(['remove', id])).stdout).effect, 'selection-only')
      assert.equal(active.host.get(DATA_PORTS.hydra), running)
      assert.deepEqual(await consumers(), baseline)
      await restart('1.0.0')
      assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
      assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
      assert.equal(calls, mode === 'unconfigured' ? 0 : 4, 'Only each configured source creates a client')
    } finally { await active?.host.stop(); fs.rmSync(root, { recursive: true, force: true }) }
  })
}
