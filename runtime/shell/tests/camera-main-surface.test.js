'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { install } = require('./helpers/camera-selection')
const { prepare } = require('./helpers/camera-surface-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath, updateConfig, readConfig } = require('../src/plugin-config')
const { randomUUID } = require('node:crypto')
const { resolveShellHost } = require('../src/platform')
const { requestLocalControl } = require('../src/local-control-client')
const { readMarker, writeMarker } = require('./helpers/camera-runtime-checkpoints')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const execute = require('node:util').promisify(require('node:child_process').execFile)

for (const mode of ['live', 'unavailable']) test(`actual Main jointly starts signed Camera source and ${mode} surface across revisions`,
  { timeout: 180000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-camera-joint-'))
    const runtimeRoot = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-cr-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
      ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280' }
    env.ODK_CAMERA_PRIVATE_PIPE_PREFIX = '\\\\.\\pipe\\odk-camera-' + randomUUID().replaceAll('-', '') + '-'
    delete env.XDG_RUNTIME_DIR
    const enabled = new Set(['odk.source.camera', 'odk.system.renderer-development'])
    env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
    try {
      const native = await install(root, env, { signal: t.signal })
      const sourcePreference = structuredClone(native.config().plugins['odk.source.camera'])
      const sourceSnapshot = await native.store.snapshot(sourcePreference.native.revision)
      const directory = path.join(root, 'surface')
      await fs.cp(path.join(__dirname, 'fixtures/camera-surface-replacement'), directory, { recursive: true })
      await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.camera').lifecycle.mount = () => { throw Error('Default Camera delegation refused') }\n")
      const surface = await prepare(root, env, directory, { signal: t.signal })
      const policy = path.join(root, 'publishers.json')
      await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {
        ...JSON.parse(await fs.readFile(native.keyring)).publishers,
        ...JSON.parse(await fs.readFile(surface.keyring)).publishers,
      } }))
      env.ODK_NATIVE_KEYRING = policy
      updateConfig(resolveConfigPath(env), config => ({ ...config, plugins: { ...config.plugins,
        'odk.tile.camera': { ...config.plugins['odk.tile.camera'], enabled: true }, 'odk.tile.clock': { enabled: false } } }))
      const pids = new Set()
      const launch = async (surfaceVersion, runtime = false) => {
        const profile = await fs.mkdtemp(path.join(root, 'electron-'))
        const childEnv = { ...env, ODK_CAMERA_BOOTSTRAP_PROFILE: profile, ODK_CAMERA_BOOTSTRAP_VERSION: '2.0.0',
          ODK_CAMERA_BOOTSTRAP_MODE: mode, ODK_CAMERA_BOOTSTRAP_SURFACE_VERSION: surfaceVersion }
        if (runtime) {
          childEnv.XDG_RUNTIME_DIR = runtimeRoot
          childEnv.ODK_CAMERA_BOOTSTRAP_SURFACE_RUNTIME = '1'
          childEnv.ODK_DISABLED_PLUGINS = childEnv.ODK_DISABLED_PLUGINS.split(',').filter(id => id !== 'odk.system.renderer-control').join(',')
        }
        delete childEnv.ELECTRON_RUN_AS_NODE
        const operation = execute(require('electron'), [`--user-data-dir=${profile}`, '--force-device-scale-factor=1',
          path.join(__dirname, 'camera-main-bootstrap.cjs')], { env: childEnv, timeout: 45000,
          killSignal: 'SIGKILL', signal: t.signal, maxBuffer: 1024 * 1024 })
        const closed = new Promise(resolve => operation.child.once('close', resolve))
        const outcome = operation.then(result => ({ result }), error => ({ error }))
        let failure
        try {
          if (runtime) {
            const ready = await readMarker(path.join(profile, 'runtime-ready.json'), { signal: t.signal, outcome })
            assert.equal(ready.version, surfaceVersion)
            const command = args => runCommand(process.execPath, ['--require', path.resolve(__dirname, 'helpers/camera-private-host.cjs'), path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), ...args],
              { env: childEnv, signal: t.signal, timeout: 10000, maxBuffer: 65536 })
            const configPath = resolveConfigPath(env)
            let sequence = 0
            const probe = async version => {
              sequence++
              await writeMarker(path.join(profile, `runtime-step-${sequence}.json`), { version })
              assert.deepEqual(await readMarker(path.join(profile, `runtime-result-${sequence}.json`), { signal: t.signal, outcome }), { version })
            }
            for (const target of ['2.0.0', '3.0.0']) {
              if (surfaceVersion === '1.0.0') {
                const bundle = target === '2.0.0' ? directory : path.join(root, 'surface-revision-3.0.0')
                await command(['native', ...(target === '2.0.0' ? ['install', bundle] : ['update', 'odk.tile.camera', bundle]),
                  '--keyring', policy, '--trust'])
              } else await command(['native', 'rollback', 'odk.tile.camera', '--keyring', policy])
              const before = await fs.readFile(configPath)
              const receipt = JSON.parse((await command(['activate', 'odk.tile.camera', '--runtime'])).stdout)
              assert.equal(receipt.scope, 'electron-renderer')
              assert.equal(receipt.version, target)
              assert.equal(receipt.revision, readConfig(configPath).plugins['odk.tile.camera'].native.revision)
              assert.deepEqual(await fs.readFile(configPath), before)
              await probe(target)
              if (target === '2.0.0') {
                const savedPolicy = await fs.readFile(policy)
                const broken = Buffer.from('{ malformed fixture configuration')
                const revoked = Buffer.from(JSON.stringify({ schemaVersion: 1, publishers: {} }))
                await fs.writeFile(configPath, broken)
                await fs.writeFile(policy, revoked)
                try {
                  const restored = JSON.parse((await command(['restore-default', 'odk.tile.camera', '--runtime'])).stdout)
                  assert.equal(restored.scope, 'electron-renderer')
                  assert.equal(restored.implementation, 'built-in')
                  assert.equal(restored.version, '1.0.0')
                  assert.equal(restored.revision, undefined)
                  assert.deepEqual(await fs.readFile(configPath), broken)
                  assert.deepEqual(await fs.readFile(policy), revoked)
                  await probe('1.0.0')
                } finally {
                  await fs.writeFile(configPath, before)
                  await fs.writeFile(policy, savedPolicy)
                }
                const resumed = JSON.parse((await command(['activate', 'odk.tile.camera', '--runtime'])).stdout)
                assert.equal(resumed.version, '2.0.0')
                assert.deepEqual(await fs.readFile(configPath), before)
                await probe('2.0.0')
              }
            }
            await writeMarker(path.join(profile, 'runtime-finish.json'), {})
          }
          const settled = await outcome
          if (settled.error) throw settled.error
          const result = settled.result
          const report = JSON.parse(result.stdout.trim().split('\n').pop())
          assert.equal(report.pid, operation.child.pid)
          assert.equal(pids.has(report.pid), false)
          pids.add(report.pid)
          assert.equal(report.productionMain, true)
          assert.equal(report.actualPreload, true)
          assert.equal(report.defaultConstructions, 0)
          assert.equal(report.version, '2.0.0')
          assert.equal(report.executedVersion, '2.0.0')
          assert.equal(report.handlerReleased, true)
          assert.equal(report.hidden, true)
          assert.equal(report.captureCalls, 1)
          assert.ok(report.surface, 'Actual Main must render the selected Camera surface')
          assert.equal(report.surface.version, surfaceVersion)
          assert.equal(report.surface.executedVersion, surfaceVersion === '1.0.0' ? null : surfaceVersion)
          assert.equal(report.surface.entries, surfaceVersion === '1.0.0' ? 0 : 1)
          assert.equal(report.surface.protocolActive, surfaceVersion !== '1.0.0' || runtime)
          if (runtime) {
            assert.deepEqual(report.surface.runtimeVersions, ['2.0.0', '1.0.0', '2.0.0', '3.0.0'])
            assert.equal(report.surface.documentLoads, 1)
            assert.equal(report.surface.trackedSubscriptionsReleased, true)
            if (process.platform === 'win32') {
              const tokenFile = resolveShellHost({ env: childEnv }).localChannelTokenFile
              await fs.stat(tokenFile)
              await assert.rejects(requestLocalControl({
                endpoint: childEnv.ODK_CAMERA_PRIVATE_PIPE_PREFIX + 'renderer-plugin-control', tokenFile,
                platform: 'win32', request: { command: 'inventory' }, label: 'Camera control pipe release',
              }), /ENOENT|ECONNREFUSED/)
            } else {
              await assert.rejects(fs.stat(path.join(runtimeRoot, 'odk-plugins/renderer-control.sock')), { code: 'ENOENT' })
            }
          }
          assert.equal(report.surface.released, true)
          assert.deepEqual(native.config().plugins['odk.source.camera'], sourcePreference)
          assert.deepEqual(native.config().plugins['odk.tile.clock'], { enabled: false })
          assert.equal(report.consumer.frame.status, mode)
          assert.equal(report.consumer.health.state, mode === 'live' ? 'healthy' : 'failed')
          return { consumer: report.consumer, rendered: report.surface.rendered }
        } catch (error) {
          failure = error
          throw error
        } finally {
          if (operation.child.exitCode === null && operation.child.signalCode === null) operation.child.kill('SIGKILL')
          const settled = await outcome
          if (failure && settled.error?.stderr) failure.message += `\nCamera child diagnostics:\n${settled.error.stderr}`
          await closed
          await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        }
      }
      const id = 'odk.tile.camera'
      const first = native.config().plugins[id].native.revision
      const firstSnapshot = await surface.store.snapshot(first)
      const consumer = await launch('2.0.0')
      const updated = surface.bundle('3.0.0')
      await surface.command(['update', id, updated, '--keyring', policy, '--trust'])
      const second = native.config().plugins[id].native.revision
      const secondSnapshot = await surface.store.snapshot(second)
      assert.notEqual(first, second)
      const requiredRuntime = async (name, operation) => {
        let failure
        await t.test(name, async () => {
          try { await operation() }
          catch (error) { failure = error; throw error }
        })
        if (failure) throw failure
      }
      await requiredRuntime('authenticated Camera activation and recovery retain the source and document', async () => {
        assert.deepEqual(await launch('3.0.0', true), consumer)
      })
      await requiredRuntime('authenticated Camera activation publishes into an initially empty route', async () => {
        await surface.command(['remove', id])
        assert.deepEqual(await launch('1.0.0', true), consumer)
        assert.equal(native.config().plugins[id].native.revision, second)
      })
      const bytes = await fs.readFile(resolveConfigPath(env))
      await fs.appendFile(path.join(updated, 'entry.js'), '\nthrow Error("Unsigned Camera surface update")')
      await assert.rejects(surface.command(['update', id, updated, '--keyring', policy, '--trust']), /native file hash mismatch/)
      assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
      await surface.command(['rollback', id, '--keyring', policy])
      assert.equal(native.config().plugins[id].native.revision, first)
      assert.deepEqual(await launch('2.0.0'), consumer)
      await surface.command(['remove', id])
      assert.deepEqual(await launch('1.0.0'), consumer)
      assert.equal(pids.size, 5)
      assert.deepEqual([...(await surface.store.snapshot(first)).files], [...firstSnapshot.files])
      assert.deepEqual([...(await surface.store.snapshot(second)).files], [...secondSnapshot.files])
      assert.deepEqual([...(await native.store.snapshot(sourcePreference.native.revision)).files], [...sourceSnapshot.files])
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
