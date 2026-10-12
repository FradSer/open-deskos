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
const { prepare } = require('./helpers/hydra-surface-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')
const { wait } = require('./helpers/hydra-wire-lifecycle')
const { posixOnlyReason } = require('./not-ported')

test('actual Main jointly starts signed Hydra source and surface through canonical MQTT', { timeout: 240000 }, async t => {
  const fixture = path.join(__dirname, 'hydra-main-bootstrap.cjs')
  await fs.access(fixture)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-main-surface-'))
  const runtimeRoot = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-hr-'))
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
    const sourceRevision = native.config().plugins['odk.source.hydra'].native.revision
    const sourceSnapshot = await native.store.snapshot(sourceRevision)
    const sourcePreference = structuredClone(native.config().plugins['odk.source.hydra'])
    const directory = path.join(root, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/hydra-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.hydra').lifecycle.mount = () => { throw Error('Default Hydra mount refused') }\n")
    const surface = await prepare(root, env, directory, { signal: t.signal })
    const policy = path.join(root, 'publishers.json')
    await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {
      ...JSON.parse(await fs.readFile(native.keyring)).publishers,
      ...JSON.parse(await fs.readFile(surface.keyring)).publishers,
    } }))
    env.ODK_NATIVE_KEYRING = policy
    const pids = new Set()
    const launch = async (version, runtime = false, stylesheet = false) => {
      const connectionsBefore = received.filter(packet => packet.cmd === 'connect').length
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_HYDRA_BOOTSTRAP_PROFILE: profile, ODK_HYDRA_BOOTSTRAP_VERSION: '2.0.0', ODK_HYDRA_BOOTSTRAP_SURFACE_VERSION: version }
      if (runtime || stylesheet) {
        childEnv.XDG_RUNTIME_DIR = runtimeRoot
        if (runtime) childEnv.ODK_HYDRA_BOOTSTRAP_SURFACE_RUNTIME = '1'
        if (stylesheet) childEnv.ODK_HYDRA_BOOTSTRAP_CSS_RECOVERY = '1'
        childEnv.ODK_HYDRA_BOOTSTRAP_SURFACE_FIRST = directory
        childEnv.ODK_HYDRA_BOOTSTRAP_SURFACE_NEXT = path.join(root, 'surface-revision-3.0.0')
        childEnv.ODK_DISABLED_PLUGINS = childEnv.ODK_DISABLED_PLUGINS.split(',').filter(id => id !== 'odk.system.renderer-control').join(',')
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
        assert.equal(report.version, '2.0.0')
        assert.equal(report.executedVersion, '2.0.0')
        assert.equal(report.defaultConstructions, 0)
        assert.ok(report.surface, 'Actual Main must render the selected Hydra surface')
        assert.equal(report.surface.version, version)
        assert.equal(report.surface.executedVersion, version === '1.0.0' ? null : version)
        assert.equal(report.surface.entries, version === '1.0.0' ? 0 : 1)
        assert.equal(report.surface.protocolActive, version !== '1.0.0' || runtime)
        assert.equal(report.surface.released, true)
        if (runtime) {
          assert.deepEqual(report.surface.runtimeVersions, ['2.0.0', '1.0.0', '2.0.0', '3.0.0'])
          await assert.rejects(fs.stat(path.join(runtimeRoot, 'odk-plugins/renderer-control.sock')), { code: 'ENOENT' })
        }
        if (stylesheet) assert.equal(report.surface.stylesheetRestored, true)
        assert.deepEqual(native.config().plugins['odk.source.hydra'], sourcePreference)
        assert.equal(report.handlerReleased, true)
        assert.equal(report.hidden, true)
        await wait(Promise.all(closures), t.signal)
        assert.equal(sockets.size, 0)
        assert.equal(received.filter(packet => packet.cmd === 'connect').length, connectionsBefore + 1)
        assert.equal(errors.length, 0)
        return { consumer: report.consumer, rendered: report.surface.rendered }
      } finally { await closed; await fs.rm(profile, { recursive: true, force: true }) }
    }
    const id = 'odk.tile.hydra'
    const first = native.config().plugins[id].native.revision
    const firstSnapshot = await surface.store.snapshot(first)
    const consumer = await launch('2.0.0')
    const updated = surface.bundle('3.0.0')
    await surface.command(['update', id, updated, '--keyring', policy, '--trust'])
    const second = native.config().plugins[id].native.revision
    const secondSnapshot = await surface.store.snapshot(second)
    assert.notEqual(first, second)
    const runtimeSkip = posixOnlyReason('isolated-native-activation')
    if (runtimeSkip) assert.deepEqual(await launch('3.0.0'), consumer)
    await t.test('authenticated Renderer activation and built-in recovery retain production document and source', { skip: runtimeSkip }, async () => {
      assert.deepEqual(await launch('3.0.0', true), consumer)
    })
    await t.test('authenticated Renderer activation publishes into an initially empty production route', { skip: runtimeSkip }, async () => {
      await surface.command(['remove', id])
      assert.deepEqual(await launch('1.0.0', true), consumer)
      assert.equal(native.config().plugins[id].native.revision, second)
    })
    const bytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(updated, 'entry.js'), '\nthrow Error("Unsigned Hydra bootstrap update")')
    await assert.rejects(surface.command(['update', id, updated, '--keyring', policy, '--trust']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
    await surface.command(['rollback', id, '--keyring', policy])
    assert.equal(native.config().plugins[id].native.revision, first)
    assert.deepEqual(await launch('2.0.0'), consumer)
    await surface.command(['remove', id])
    assert.deepEqual(await launch('1.0.0'), consumer)
    assert.equal(pids.size, runtimeSkip ? 4 : 5)
    assert.deepEqual([...(await surface.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await surface.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(sourceRevision)).files], [...sourceSnapshot.files])
    assert.equal(consumer.consumer.snapshot.env.tempC, 24.5)
    assert.equal(consumer.consumer.snapshot.nodes[0].soilPercent, 42)
    assert.equal(consumer.consumer.snapshot.nodes[0].pump, true)
    assert.equal(consumer.consumer.snapshot.nodes[0].stale, false)
    assert.equal(consumer.consumer.health.state, 'healthy')
    for (const packet of received.filter(packet => packet.cmd === 'connect')) {
      assert.equal(packet.protocolVersion, 4)
      assert.equal(packet.username, undefined)
      assert.equal(packet.password, undefined)
    }
    const subscriptions = received.filter(packet => packet.cmd === 'subscribe')
    assert.equal(subscriptions.length, runtimeSkip ? 4 : 5)
    for (const packet of subscriptions) assert.deepEqual(packet.subscriptions.map(({ topic, qos }) => ({ topic, qos })), [{ topic: 'plants/#', qos: 0 }])
    await t.test('authenticated Renderer recovery removes signed startup CSS without changing data or configuration', { skip: runtimeSkip }, async () => {
      const cssDirectory = path.join(root, 'css-surface')
      await fs.cp(directory, cssDirectory, { recursive: true })
      const cssSurface = await prepare(root, env, cssDirectory, { signal: t.signal, stylesheet: true })
      await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {
        ...JSON.parse(await fs.readFile(native.keyring)).publishers,
        ...JSON.parse(await fs.readFile(cssSurface.keyring)).publishers,
      } }))
      assert.deepEqual(await launch('2.0.0', false, true), consumer)
    })
  } finally {
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(runtimeRoot, { recursive: true, force: true })
  }
})
