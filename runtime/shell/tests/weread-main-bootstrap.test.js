'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/weread-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')

for (const mode of ['live', 'empty', 'error', 'unconfigured']) test(`actual Main WeRead ${mode} preserves signed revisions and preload consumers`,
  { timeout: 240000 }, async t => {
    const fixture = path.join(__dirname, 'weread-main-bootstrap.cjs')
    await fs.access(fixture)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weread-main-'))
    const cacheFile = path.join(root, 'weread-highlights.json')
    const env = { ...process.env, ODK_WEREAD_BOOTSTRAP_MODE: mode, ODK_WEREAD_BOOTSTRAP_CACHE: cacheFile, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
      ODESK_SHELL_TEST_MODE: '1', ODESK_SHELL_KIOSK: '0', ODESK_SHELL_WIDTH: '1920', ODESK_SHELL_HEIGHT: '1280' }
    delete env.XDG_RUNTIME_DIR
    const enabled = new Set(['odk.source.weread', 'odk.system.renderer-development'])
    env.ODESK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
    try {
      const native = await install(root, env, { signal: t.signal })
      const pids = new Set()
      const launch = async version => {
        const profile = await fs.mkdtemp(path.join(root, 'electron-'))
        const childEnv = { ...env, ODK_WEREAD_BOOTSTRAP_PROFILE: profile, ODK_WEREAD_BOOTSTRAP_VERSION: version }
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
          assert.equal(report.defaultConstructions, version === '1.0.0' ? 1 : 0)
          assert.equal(report.apiCalls, mode === 'live' ? (version === '2.0.0' && pids.size === 1 ? 2 : 0) : mode === 'unconfigured' ? 0 : 1)
          assert.equal(report.coverCalls, mode === 'live' ? 1 : 0)
          assert.equal(report.cacheLoaded, mode === 'live' && pids.size > 1)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.hidden, true)
          return { consumer: report.consumer, health: report.health }
        } finally {
          await closed
          await fs.rm(profile, { recursive: true, force: true })
        }
      }
      const id = 'odk.source.weread'
      const first = native.config().plugins[id].native.revision
      const firstSnapshot = await native.store.snapshot(first)
      const consumer = await launch('2.0.0')
      const cacheBytes = mode === 'live' ? await fs.readFile(cacheFile) : null
      const updated = native.bundle('3.0.0')
      const authorization = ['--keyring', native.keyring, '--trust', '--grant', 'source.weread', '--grant', 'ipc']
      await native.command(['update', id, updated, ...authorization])
      const second = native.config().plugins[id].native.revision
      const secondSnapshot = await native.store.snapshot(second)
      assert.notEqual(first, second)
      assert.deepEqual(await launch('3.0.0'), consumer)
      const bytes = await fs.readFile(resolveConfigPath(env))
      await fs.appendFile(path.join(updated, 'entry.cjs'), '\nthrow Error("Unsigned WeRead update")')
      await assert.rejects(native.command(['update', id, updated, ...authorization]), /native file hash mismatch/)
      assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
      await native.command(['rollback', id, '--keyring', native.keyring])
      assert.equal(native.config().plugins[id].native.revision, first)
      assert.deepEqual(await launch('2.0.0'), consumer)
      await native.command(['remove', id])
      assert.deepEqual(await launch('1.0.0'), consumer)
      assert.equal(pids.size, 4)
      assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
      assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
      assert.equal(consumer.consumer.status, mode)
      assert.equal(consumer.health.state, { live: 'healthy', empty: 'healthy', error: 'failed', unconfigured: 'degraded' }[mode])
      if (mode === 'live') {
        assert.equal(consumer.consumer.highlight.markText, 'Controlled highlight\n独立插件保持原文。')
        assert.equal(consumer.consumer.highlight.cover, 'data:image/png;base64,Y292ZXI=')
        assert.deepEqual(await fs.readFile(cacheFile), cacheBytes)
        const cache = JSON.parse(cacheBytes)
        assert.equal(cache.version, 2)
        assert.equal(cache.highlights[0].cover, 'https://fixture.example.test/cover.png')
      } else { await assert.rejects(fs.access(cacheFile), { code: 'ENOENT' }) }
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
