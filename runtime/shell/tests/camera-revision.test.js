'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { install } = require('./helpers/camera-selection')
const { createCameraSource, createCameraCaptureProvider } = require('../src/camera-source')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { resolveConfigPath, updateConfig } = require('../src/plugin-config')
const id = 'odk.source.camera'
const sourcePort = 'odk:source/camera/v1'
const healthPort = 'odk:plugin-health/odk.source.camera/v1'
const jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(8192), Buffer.from([255, 217])])

for (const mode of ['live', 'unavailable']) test(`signed Camera ${mode} consumers survive update rollback and removal`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-camera-revisions-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  let active
  let calls = 0
  const files = new Map()
  const options = { device: '/synthetic/camera', now: () => 1700000000000,
    fsImpl: { existsSync: () => true, mkdtempSync: prefix => prefix + 'revision',
      readFileSync: file => files.get(file), rmSync: () => files.clear() },
    execFileImpl: async (_command, args) => {
      calls++
      if (mode === 'unavailable') throw Error('Controlled capture failure')
      files.set(args.find(arg => arg.startsWith('--stream-to=')).slice('--stream-to='.length), jpeg)
    },
  }
  try {
    const native = await install(root, env)
    assert.equal(typeof native.bundle, 'function', 'Camera revision acceptance needs distinct signed bundles')
    updateConfig(resolveConfigPath(env), config => ({ ...config, plugins: { ...config.plugins,
      [id]: { ...config.plugins[id], enabled: true }, 'odk.tile.clock': { enabled: false } } }))
    const peer = structuredClone(native.config().plugins['odk.tile.clock'])
    const consumers = async () => ({ ipc: await active.handlers.get('odk-camera-frame')(null),
      health: active.host.get(healthPort).snapshot() })
    const open = async version => {
      const replacements = await native.load()
      assert.equal(replacements.length, version === '1.0.0' ? 0 : 1)
      const handlers = new Map()
      let created = 0
      const host = createPluginHost({ capabilities: {
        ipc: { handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler) },
          removeHandler: channel => handlers.delete(channel) },
        'source.camera': { options, provider: createCameraCaptureProvider, create(configuration) {
          assert.equal(version, '1.0.0', 'Signed Camera must not construct the default source')
          created++
          return createCameraSource(configuration)
        } },
      } })
      active = { host, handlers }
      host.register(createMainPlugins({ replacementPlugins: replacements }).find(plugin => plugin.manifest.id === id))
      await host.start()
      assert.equal(host.list()[0].manifest.version, version)
      assert.equal(host.get(sourcePort).fixtureRevision, version === '1.0.0' ? undefined : version)
      assert.equal(created, version === '1.0.0' ? 1 : 0)
    }
    const restart = async version => {
      await active.host.stop()
      assert.equal(active.handlers.size, 0)
      assert.equal(files.size, 0)
      await open(version)
      assert.deepEqual(await consumers(), baseline)
      assert.deepEqual(native.config().plugins['odk.tile.clock'], peer)
      assert.equal(native.config().plugins[id].enabled, true)
    }
    await open('2.0.0')
    const baseline = await consumers()
    const first = native.config().plugins[id].native.revision
    const firstSnapshot = await native.store.snapshot(first)
    const bundle = native.bundle('3.0.0')
    let running = active.host.get(sourcePort)
    assert.equal(JSON.parse((await native.command(['update', id, bundle, '--keyring', native.keyring,
      '--trust', '--grant', 'source.camera', '--grant', 'ipc'])).stdout).effect, 'selection-only')
    const second = native.config().plugins[id].native.revision
    const secondSnapshot = await native.store.snapshot(second)
    assert.notEqual(second, first)
    assert.equal(active.host.get(sourcePort), running)
    assert.deepEqual(await consumers(), baseline)
    await restart('3.0.0')
    running = active.host.get(sourcePort)
    const configBytes = fs.readFileSync(resolveConfigPath(env))
    fs.appendFileSync(path.join(bundle, 'entry.cjs'), '\nthrow Error("Unsigned Camera update")')
    await assert.rejects(native.command(['update', id, bundle, '--keyring', native.keyring,
      '--trust', '--grant', 'source.camera', '--grant', 'ipc']), /native file hash mismatch/)
    assert.deepEqual(fs.readFileSync(resolveConfigPath(env)), configBytes)
    assert.equal(active.host.get(sourcePort), running)
    assert.deepEqual(await consumers(), baseline)
    assert.equal(JSON.parse((await native.command(['rollback', id, '--keyring', native.keyring])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native.revision, first)
    assert.equal(active.host.get(sourcePort), running)
    await restart('2.0.0')
    running = active.host.get(sourcePort)
    assert.equal(JSON.parse((await native.command(['remove', id])).stdout).effect, 'selection-only')
    assert.equal(active.host.get(sourcePort), running)
    assert.deepEqual(await consumers(), baseline)
    await restart('1.0.0')
    assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.equal(calls, 4, 'Each new source captures once; cached consumers and health do not add capture work')
    assert.equal(baseline.ipc.status, mode)
    assert.equal(baseline.health.state, mode === 'live' ? 'healthy' : 'failed')
  } finally { await active?.host.stop(); fs.rmSync(root, { recursive: true, force: true }) }
})
