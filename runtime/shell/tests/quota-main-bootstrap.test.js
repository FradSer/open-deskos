'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const crypto = require('node:crypto')
const path = require('node:path')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/quota-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')

test('actual Main bootstrap preserves independent Quota revisions and all preload states',
  { timeout: 240000 }, async t => {
    const fixture = path.join(__dirname, 'quota-main-bootstrap.cjs')
    await fs.access(fixture)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-quota-main-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
      ODK_SHELL_TEST_MODE: '1', ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280' }
    delete env.XDG_RUNTIME_DIR
    const enabled = new Set(['odk.source.quota', 'odk.system.renderer-development'])
    env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
    try {
      const native = await install(root, env, { signal: t.signal })
      const pids = new Set()
      const launch = async version => {
        const profile = await fs.mkdtemp(path.join(root, 'electron-'))
        const childEnv = { ...env, ODK_QUOTA_BOOTSTRAP_PROFILE: profile, ODK_QUOTA_BOOTSTRAP_VERSION: version }
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
          assert.equal(report.providerCalls, 5)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.hidden, true)
          return report.consumer
        } finally {
          await closed
          await fs.rm(profile, { recursive: true, force: true })
        }
      }
      const id = 'odk.source.quota'
      const first = native.config().plugins[id].native.revision
      const firstSnapshot = await native.store.snapshot(first)
      const consumer = await launch('2.0.0')
      const updated = native.bundle(id, '3.0.0')
      const authorization = ['--keyring', native.keyring, '--trust', '--grant', 'source.quota', '--grant', 'ipc']
      await native.command(['update', id, updated, ...authorization])
      const second = native.config().plugins[id].native.revision
      const secondSnapshot = await native.store.snapshot(second)
      assert.notEqual(first, second)
      assert.deepEqual(await launch('3.0.0'), consumer)
      const bytes = await fs.readFile(resolveConfigPath(env))
      await fs.appendFile(path.join(updated, 'entry.cjs'), '\nthrow Error("Unsigned Quota update")')
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
      assert.deepEqual(consumer.map(result => result.state), ['available', 'available', 'unauthorized', 'unavailable', 'unconfigured'])
      assert.equal(consumer[0].snapshot.accounts[0].groups[0].quotas[0].remainingPct, 12.345)
      assert.equal(consumer[0].snapshot.accounts[0].groups[0].quotas[1].remainingPct, 0)
      assert.deepEqual(consumer[1].snapshot.accounts, [])
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

test('actual Main jointly selects Quota source and page and preserves authenticated page recovery',
  { timeout: 120000 }, async t => {
    const { runCommand } = require('./helpers/hydra-wire-lifecycle')
    const { posixOnlyReason } = require('./not-ported')
    if (posixOnlyReason('isolated-native-activation')) return t.skip(posixOnlyReason('isolated-native-activation'))
    const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-quota-joint-'))
    let baseline
    try {
      for (const mode of ['default', 'selected', 'incorrect', 'missing']) {
        const directory = path.join(root, mode)
        await fs.mkdir(directory)
        const version = mode === 'default' ? '1.0.0' : '2.0.0'
        const profile = path.join(directory, 'profile')
        const env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config'),
          XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state'), XDG_RUNTIME_DIR: path.join(directory, 'runtime'),
          ODK_QUOTA_BOOTSTRAP_PROFILE: profile, ODK_QUOTA_BOOTSTRAP_VERSION: version, ODK_QUOTA_MAIN_SURFACE_MODE: mode,
          ODK_WORKSPACE: path.join(directory, 'workspace'), ODK_SHELL_TEST_MODE: '1', ODK_SHELL_KIOSK: '0',
          ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_DISABLE_GPU: '1' }
        const enabled = new Set(['odk.source.quota', 'odk.system.renderer-development', 'odk.system.renderer-control'])
        env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
        delete env.ELECTRON_RUN_AS_NODE
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        if (mode !== 'default') await install(directory, env, { signal: t.signal })
        if (['selected', 'incorrect'].includes(mode)) {
          const folder = path.join(directory, 'page')
          await fs.cp(path.join(__dirname, 'fixtures/quota-surface-replacement'), folder, { recursive: true })
          const entry = path.join(folder, 'entry.js')
          let source = await fs.readFile(entry, 'utf8')
          if (mode === 'incorrect') {
            assert.ok(source.includes('Math.round(value)'))
            source = source.replace('Math.round(value)', 'Math.round(value) + 1')
          }
          await fs.writeFile(entry, source + '\nwindow.quotaMainEntries ||= [];window.quotaMainEntries.push("2.0.0");\n')
          const keys = crypto.generateKeyPairSync('ed25519')
          const policy = JSON.parse(await fs.readFile(env.ODK_NATIVE_KEYRING, 'utf8'))
          policy.publishers['quota-surface'] = { publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.page.quota'], hosts: ['electron-renderer'] }
          await fs.writeFile(env.ODK_NATIVE_KEYRING, JSON.stringify(policy))
          const files = []
          for (const name of ['entry.js', 'manifest.json']) files.push({ path: name, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(folder, name))).digest('hex') })
          const payload = { schemaVersion: 1, keyId: 'quota-surface', replace: true, files }
          await fs.writeFile(path.join(folder, 'bundle.json'), JSON.stringify({ ...payload,
            signature: crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64') }))
          await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'native', 'install', folder, '--keyring', env.ODK_NATIVE_KEYRING, '--trust'],
            { env, signal: t.signal, timeout: 10000 })
        }
        const running = runCommand(require('electron'), [`--user-data-dir=${profile}`, path.join(__dirname, 'quota-main-bootstrap.cjs')],
          { env, signal: t.signal, timeout: 55000, maxBuffer: 1024 * 1024 })
        if (mode === 'incorrect') await assert.rejects(running, /Production Quota page reading changed/)
        else if (mode === 'missing') await assert.rejects(running, /Production Quota page fallback guard triggered/)
        else {
          const report = JSON.parse((await running).stdout.trim().split('\n').pop())
          assert.equal(report.productionMain, true)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.version, version)
          assert.equal(report.surface.entries, mode === 'default' ? 0 : 2)
          assert.equal(report.surface.phases.length, mode === 'default' ? 1 : 3)
          assert.equal(report.surface.subscriptionsReleased, true)
          assert.equal(report.surface.protocolReleased, true)
          assert.equal(report.providerCalls, mode === 'default' ? 5 : 15)
          for (const phase of report.surface.phases) {
            if (baseline) assert.deepEqual(phase, baseline)
            else baseline = phase
          }
          const { resolveShellHost } = require('../src/platform')
          await assert.rejects(fs.stat(resolveShellHost({ env }).endpoint('renderer-plugin-control')), { code: 'ENOENT' })
        }
      }
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
