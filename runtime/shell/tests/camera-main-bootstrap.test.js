'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/camera-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')

for (const mode of ['live', 'unavailable']) test(`actual Main bootstrap preserves Camera ${mode} signed revisions and preload`,
  { timeout: 240000 }, async t => {
    const fixture = path.join(__dirname, 'camera-main-bootstrap.cjs')
    await fs.access(fixture)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-camera-main-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
      ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280' }
    env.ODK_CAMERA_PRIVATE_PIPE_PREFIX = '\\\\.\\pipe\\odk-camera-' + randomUUID().replaceAll('-', '') + '-'
    delete env.XDG_RUNTIME_DIR
    const enabled = new Set(['odk.source.camera', 'odk.system.renderer-development'])
    env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
    try {
      const native = await install(root, env, { signal: t.signal })
      const pids = new Set()
      const launch = async version => {
        const profile = await fs.mkdtemp(path.join(root, 'electron-'))
        const childEnv = { ...env, ODK_CAMERA_BOOTSTRAP_PROFILE: profile, ODK_CAMERA_BOOTSTRAP_VERSION: version, ODK_CAMERA_BOOTSTRAP_MODE: mode }
        delete childEnv.ELECTRON_RUN_AS_NODE
        const operation = execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, fixture]), {
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
          assert.equal(report.defaultConstructions, version === '1.0.0' ? 1 : 0)
          assert.equal(report.handlerReleased, true)
          assert.equal(report.captureCalls, 1)
          assert.equal(report.hidden, true)
          return report.consumer
        } finally { await closed; await fs.rm(profile, { recursive: true, force: true }) }
      }
      const id = 'odk.source.camera'
      const first = native.config().plugins[id].native.revision
      const firstSnapshot = await native.store.snapshot(first)
      const consumer = await launch('2.0.0')
      const updated = native.bundle('3.0.0')
      await native.command(['update', id, updated, '--keyring', native.keyring, '--trust', '--grant', 'source.camera', '--grant', 'ipc'])
      const second = native.config().plugins[id].native.revision
      const secondSnapshot = await native.store.snapshot(second)
      assert.notEqual(first, second)
      assert.deepEqual(await launch('3.0.0'), consumer)
      const bytes = await fs.readFile(resolveConfigPath(env))
      await fs.appendFile(path.join(updated, 'entry.cjs'), '\nthrow Error("Unsigned Camera bootstrap update")')
      await assert.rejects(native.command(['update', id, updated, '--keyring', native.keyring, '--trust', '--grant', 'source.camera', '--grant', 'ipc']), /native file hash mismatch/)
      assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
      await native.command(['rollback', id, '--keyring', native.keyring])
      assert.equal(native.config().plugins[id].native.revision, first)
      assert.deepEqual(await launch('2.0.0'), consumer)
      await native.command(['remove', id])
      assert.deepEqual(await launch('1.0.0'), consumer)
      assert.equal(pids.size, 4)
      assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
      assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
      assert.equal(consumer.frame.status, mode)
      assert.equal(consumer.frame.width, 1280)
      assert.equal(consumer.frame.height, 720)
      assert.equal(consumer.frame.capturedAt, mode === 'live' ? 1700000000000 : null)
      const jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(8192), Buffer.from([255, 217])])
      assert.equal(consumer.frame.frame, mode === 'live' ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : null)
      assert.equal(consumer.health.state, mode === 'live' ? 'healthy' : 'failed')
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
