'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/weread-selection')
const { resolveConfigPath } = require('../src/plugin-config')
const id = 'odk.source.weread'

test('signed WeRead update rollback and removal preserve separate Electron consumers', { timeout: 180000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weread-process-revisions-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const pids = new Set()
  try {
    const native = await install(root, env)
    const launch = async version => {
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_WEREAD_FIXTURE_PROFILE: profile, ODK_WEREAD_RESTART_VERSION: version }
      delete childEnv.ELECTRON_RUN_AS_NODE
      try {
        const fixture = path.join(__dirname, 'weread-plugin-electron.cjs')
        await fs.access(fixture)
        const running = execFile(require('electron'), [`--user-data-dir=${profile}`, fixture], { env: childEnv, timeout: 55000, maxBuffer: 4 * 1024 * 1024 })
        const result = await running
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.actualPreload, true)
        assert.equal(report.signedIndependent, version !== '1.0.0')
        assert.equal(report.version, version)
        assert.equal(report.processRestart, true)
        assert.notEqual(report.pid, process.pid)
        assert.equal(report.pid, running.child.pid)
        assert.equal(pids.has(report.pid), false, 'Each acceptance stage needs a separate Electron process')
        pids.add(report.pid)
        assert.equal(report.consumers.length, 15)
        return report.consumers
      } finally { await fs.rm(profile, { recursive: true, force: true }) }
    }
    const first = native.config().plugins[id].native.revision
    const firstSnapshot = await native.store.snapshot(first)
    const baseline = await launch('2.0.0')
    const bundle = native.bundle('3.0.0')
    const update = await native.command(['update', id, bundle, '--keyring', native.keyring, '--trust', '--grant', 'source.weread', '--grant', 'ipc'])
    assert.equal(JSON.parse(update.stdout).effect, 'selection-only')
    const second = native.config().plugins[id].native.revision
    const secondSnapshot = await native.store.snapshot(second)
    assert.notEqual(first, second)
    assert.deepEqual(await launch('3.0.0'), baseline)
    const configBytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(bundle, 'entry.cjs'), '\nthrow Error("Unsigned process fixture update")')
    await assert.rejects(native.command(['update', id, bundle, '--keyring', native.keyring, '--trust', '--grant', 'source.weread', '--grant', 'ipc']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), configBytes)
    assert.equal(JSON.parse((await native.command(['rollback', id, '--keyring', native.keyring])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native.revision, first)
    assert.deepEqual(await launch('2.0.0'), baseline)
    assert.equal(JSON.parse((await native.command(['remove', id])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native, undefined)
    assert.deepEqual(await launch('1.0.0'), baseline)
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
