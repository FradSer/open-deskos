'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execute = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/hydra-selection')
const { prepare } = require('./helpers/hydra-surface-selection')
const { readConfig, resolveConfigPath, updateConfig } = require('../src/plugin-config')
const id = 'odk.tile.hydra'
const cm5 = process.platform === 'linux' && process.arch === 'arm64'
const childTimeout = cm5 ? 160000 : 80000

test('signed Hydra surface revisions preserve rendered consumers across separate processes', { timeout: 4 * childTimeout + 100000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-surface-revisions-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const pids = new Set()
  try {
    const source = await install(root, env, { signal: t.signal })
    const sourceRevision = source.config().plugins['odk.source.hydra'].native.revision
    const sourceSnapshot = await source.store.snapshot(sourceRevision)
    const directory = path.join(root, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/hydra-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.hydra').lifecycle.mount = () => { throw Error('Default Hydra mount refused in independent surface acceptance') }\n")
    const surface = await prepare(root, env, directory, { signal: t.signal })
    const policy = path.join(root, 'publishers.json')
    await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {
      ...JSON.parse(await fs.readFile(source.keyring)).publishers,
      ...JSON.parse(await fs.readFile(surface.keyring)).publishers,
    } }))
    env.OPEN_DESKOS_NATIVE_KEYRING = policy
    updateConfig(resolveConfigPath(env), config => ({ ...config, plugins: { ...config.plugins,
      [id]: { ...config.plugins[id], enabled: true }, 'odk.tile.clock': { enabled: false } } }))
    const config = () => readConfig(resolveConfigPath(env))
    const peer = structuredClone(config().plugins['odk.source.hydra'])
    const launch = async version => {
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const consumers = path.join(profile, 'consumers.json')
      const childEnv = { ...env, ODK_HYDRA_SURFACE_PROFILE: profile, ODK_HYDRA_SURFACE_NATIVE: '1',
        ODK_HYDRA_SURFACE_REVISION: version, ODK_HYDRA_SURFACE_CONSUMERS: consumers }
      delete childEnv.ELECTRON_RUN_AS_NODE
      const operation = execute(require('electron'), [`--user-data-dir=${profile}`, '--force-device-scale-factor=1', path.join(__dirname, 'hydra-surface-electron.cjs')],
        { env: childEnv, signal: t.signal, timeout: childTimeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
      const closed = new Promise(resolve => operation.child.once('close', resolve))
      try {
        const result = await operation
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.pid, operation.child.pid)
        assert.equal(pids.has(report.pid), false)
        pids.add(report.pid)
        assert.equal(report.surfaceProcessRestart, true)
        assert.equal(report.surfaceVersion, version)
        assert.equal(report.executedVersion, version === '1.0.0' ? null : version)
        assert.equal(report.independentSurface, version !== '1.0.0')
        assert.equal(report.signedSurface, version !== '1.0.0')
        assert.equal(report.entryCount, version === '1.0.0' ? 0 : 1)
        assert.equal(report.actualPreload, true)
        assert.equal(report.comparisons, 240)
        assert.equal(report.discoveryReleased, true)
        assert.equal(report.assetLeaseReleased, true)
        assert.equal(report.capturedSurfaceIntegrity, false)
        assert.deepEqual(config().plugins['odk.source.hydra'], peer)
        assert.deepEqual(config().plugins['odk.tile.clock'], { enabled: false })
        assert.equal(config().plugins[id].enabled, true)
        const bytes = await fs.readFile(consumers)
        assert.equal(JSON.parse(bytes).length, 240)
        return bytes
      } finally { await closed; await fs.rm(profile, { recursive: true, force: true }) }
    }
    const first = config().plugins[id].native.revision
    const firstSnapshot = await surface.store.snapshot(first)
    const baseline = await launch('2.0.0')
    const compare = bytes => {
      if (bytes.equals(baseline)) return
      let offset = 0
      while (offset < Math.min(bytes.length, baseline.length) && bytes[offset] === baseline[offset]) offset++
      assert.fail(JSON.stringify({ offset, lengths: [baseline.length, bytes.length],
        expected: baseline.subarray(Math.max(0, offset - 150), offset + 150).toString(),
        actual: bytes.subarray(Math.max(0, offset - 150), offset + 150).toString() }))
    }
    const candidate = surface.bundle('3.0.0')
    await surface.command(['update', id, candidate, '--keyring', policy, '--trust'])
    const second = config().plugins[id].native.revision
    const secondSnapshot = await surface.store.snapshot(second)
    assert.notEqual(first, second)
    compare(await launch('3.0.0'))
    const configBytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(candidate, 'entry.js'), '\nthrow Error("Unsigned surface update")')
    await assert.rejects(surface.command(['update', id, candidate, '--keyring', policy, '--trust']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), configBytes)
    await surface.command(['rollback', id, '--keyring', policy])
    assert.equal(config().plugins[id].native.revision, first)
    compare(await launch('2.0.0'))
    await surface.command(['remove', id])
    assert.equal(config().plugins[id].native, undefined)
    compare(await launch('1.0.0'))
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await surface.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await surface.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.deepEqual([...(await source.store.snapshot(sourceRevision)).files], [...sourceSnapshot.files])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
