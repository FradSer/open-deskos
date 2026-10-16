'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const syncFs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { createRequire } = require('node:module')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const packets = createRequire(syncFs.realpathSync(require.resolve('mqtt')))('mqtt-packet')
const { install } = require('./helpers/hydra-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')
const { wait } = require('./helpers/hydra-wire-lifecycle')
const { posixOnlyReason } = require('./not-ported')

test('actual Main bootstrap preserves Hydra signed revisions through canonical MQTT and preload', { timeout: 240000 }, async t => {
  const fixture = path.join(__dirname, 'hydra-main-bootstrap.cjs')
  await fs.access(fixture)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-main-'))
  const runtimeRoot = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-hc-'))
  const sockets = new Set()
  const closures = []
  const received = []
  const errors = []
  const server = net.createServer(socket => {
    sockets.add(socket)
    closures.push(new Promise(resolve => socket.once('close', resolve)))
    socket.on('close', () => sockets.delete(socket))
    const parser = packets.parser()
    const fail = error => { errors.push(error); socket.destroy() }
    socket.on('error', fail)
    parser.on('error', fail)
    socket.on('data', bytes => parser.parse(bytes))
    parser.on('packet', packet => {
      received.push(packet)
      try {
        if (packet.cmd === 'connect') socket.write(packets.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }))
        else if (packet.cmd === 'subscribe') {
          socket.write(packets.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0) }))
          for (const [topic, payload] of [['main/online', 'true'], ['main/env', 'v=1;l=1;t=24.5;h=61.2;p=1002.6;x=12340;d=1.23'],
            ['node1/soil', '42'], ['node1/online', 'true'], ['node1/status', 'PULSE']]) {
            socket.write(packets.generate({ cmd: 'publish', topic: `plants/${topic}`, payload, retain: false, qos: 0, dup: false }))
          }
        } else if (packet.cmd === 'pingreq') socket.write(packets.generate({ cmd: 'pingresp' }))
        else if (packet.cmd === 'disconnect') socket.end()
      } catch (error) { fail(error) }
    })
  })
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
    ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_HYDRA_MQTT_TOPIC: 'plants/ignored' }
  delete env.XDG_RUNTIME_DIR
  const enabled = new Set(['odk.source.hydra', 'odk.system.renderer-development'])
  env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    env.ODK_HYDRA_MQTT_URL = `mqtt://127.0.0.1:${server.address().port}`
    const native = await install(root, env, { signal: t.signal })
    const pids = new Set()
    const launch = async (version, runtime = false) => {
      const connectionsBefore = received.filter(packet => packet.cmd === 'connect').length
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_HYDRA_BOOTSTRAP_PROFILE: profile, ODK_HYDRA_BOOTSTRAP_VERSION: version,
        ODK_HYDRA_BOOTSTRAP_RUNTIME: runtime ? '1' : '0' }
      if (runtime) {
        childEnv.XDG_RUNTIME_DIR = runtimeRoot
        childEnv.ODK_DISABLED_PLUGINS = childEnv.ODK_DISABLED_PLUGINS.split(',').filter(id => id !== 'odk.system.plugin-control').join(',')
      }
      delete childEnv.ELECTRON_RUN_AS_NODE
      const operation = execFile(require('electron'), [`--user-data-dir=${profile}`, fixture], {
        env: childEnv, timeout: 55000, killSignal: 'SIGKILL', signal: t.signal, maxBuffer: 1024 * 1024,
      })
      const closed = new Promise(resolve => operation.child.once('close', resolve))
      try {
        const result = await operation
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.pid, operation.child.pid)
        assert.equal(pids.has(report.pid), false)
        pids.add(report.pid)
        assert.equal(report.productionMain, true)
        assert.equal(report.actualPreload, true)
        assert.equal(report.version, version)
        assert.equal(report.executedVersion, version)
        assert.equal(report.defaultConstructions, runtime || version === '1.0.0' ? 1 : 0)
        assert.equal(report.handlerReleased, true)
        assert.equal(report.hidden, true)
        const phases = (await fs.readFile(path.join(profile, 'exit-phases.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
        assert.ok(phases.some(phase => phase.event === 'before-quit'))
        assert.deepEqual(phases.slice(-3).map(phase => phase.event), ['will-quit', 'release-verified', 'quit'])
        if (runtime) {
          assert.deepEqual(report.runtimeVersions, ['2.0.0', '1.0.0', '3.0.0'])
          await assert.rejects(fs.stat(path.join(runtimeRoot, 'odk-plugins/control.sock')), { code: 'ENOENT' })
        }
        await wait(Promise.all(closures), t.signal)
        assert.equal(sockets.size, 0)
        assert.equal(received.filter(packet => packet.cmd === 'connect').length, connectionsBefore + (runtime ? 4 : 1))
        assert.equal(errors.length, 0)
        return report.consumer
      } catch (error) {
        const phases = await fs.readFile(path.join(profile, 'exit-phases.jsonl'), 'utf8').catch(() => null)
        if (phases) error.message += `\nHydra exit phases:\n${phases}`
        throw error
      } finally { await closed; await fs.rm(profile, { recursive: true, force: true }) }
    }
    const id = 'odk.source.hydra'
    const first = native.config().plugins[id].native.revision
    const firstSnapshot = await native.store.snapshot(first)
    const consumer = await launch('2.0.0')
    const updated = native.bundle('3.0.0')
    await native.command(['update', id, updated, '--keyring', native.keyring, '--trust', '--grant', 'source.hydra', '--grant', 'ipc'])
    const second = native.config().plugins[id].native.revision
    const secondSnapshot = await native.store.snapshot(second)
    assert.notEqual(first, second)
    const runtimeSkip = posixOnlyReason('isolated-native-activation')
    if (runtimeSkip) assert.deepEqual(await launch('3.0.0'), consumer)
    await t.test('authenticated activation preserves actual Main and preload in one process', { skip: runtimeSkip }, async () => {
      assert.deepEqual(await launch('3.0.0', true), consumer)
    })
    const bytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(updated, 'entry.cjs'), '\nthrow Error("Unsigned Hydra bootstrap update")')
    await assert.rejects(native.command(['update', id, updated, '--keyring', native.keyring, '--trust', '--grant', 'source.hydra', '--grant', 'ipc']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
    await native.command(['rollback', id, '--keyring', native.keyring])
    assert.equal(native.config().plugins[id].native.revision, first)
    assert.deepEqual(await launch('2.0.0'), consumer)
    await native.command(['remove', id])
    assert.deepEqual(await launch('1.0.0'), consumer)
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.equal(consumer.snapshot.env.tempC, 24.5)
    assert.equal(consumer.snapshot.nodes[0].soilPercent, 42)
    assert.equal(consumer.snapshot.nodes[0].pump, true)
    assert.equal(consumer.snapshot.nodes[0].stale, false)
    assert.equal(consumer.health.state, 'healthy')
    for (const packet of received.filter(packet => packet.cmd === 'connect')) {
      assert.equal(packet.protocolVersion, 4)
      assert.equal(packet.username, undefined)
      assert.equal(packet.password, undefined)
    }
    const subscriptions = received.filter(packet => packet.cmd === 'subscribe')
    assert.equal(subscriptions.length, runtimeSkip ? 4 : 7)
    for (const packet of subscriptions) assert.deepEqual(packet.subscriptions.map(({ topic, qos }) => ({ topic, qos })), [{ topic: 'plants/#', qos: 0 }])
  } finally {
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(runtimeRoot, { recursive: true, force: true })
  }
})
