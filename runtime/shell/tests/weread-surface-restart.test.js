'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { surfaceTimeouts } = require('./helpers/weread-selection')
const os = require('node:os')
const { install } = require('./helpers/weread-selection')
const { prepare } = require('./helpers/weread-surface-selection')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { readConfig, resolveConfigPath, updateConfig } = require('../src/plugin-config')
const id = 'odk.tile.weread'

test('signed independent WeRead surface update rollback and removal preserve separate Electron consumers', { timeout: surfaceTimeouts().revisions }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weread-surface-revisions-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const pids = new Set()
  const cacheFile = path.join(root, 'retained-highlights.json')
  let cacheBytes
  let cachedHighlight
  try {
    const source = await install(root, env, { signal: t.signal })
    const sourceRevision = source.config().plugins['odk.source.weread'].native.revision
    const sourceSnapshot = await source.store.snapshot(sourceRevision)
    const directory = path.join(root, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/weread-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.weread').lifecycle.mount = () => { throw Error('Default WeRead mount refused in independent surface acceptance') }\n")
    const native = await prepare(root, env, directory, { signal: t.signal })
    assert.equal(typeof native.bundle, 'function', 'Surface revision acceptance requires separately signed bundles')
    const publishers = { ...JSON.parse(await fs.readFile(source.keyring)).publishers,
      ...JSON.parse(await fs.readFile(native.keyring)).publishers }
    const policy = path.join(root, 'publishers.json')
    await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers }))
    env.ODK_NATIVE_KEYRING = policy
    env.ODK_WEREAD_SURFACE_KEYRING = policy
    updateConfig(resolveConfigPath(env), config => ({ ...config, plugins: { ...config.plugins,
      [id]: { ...config.plugins[id], enabled: true }, 'odk.tile.clock': { enabled: false } } }))
    const config = () => readConfig(resolveConfigPath(env))
    const peer = structuredClone(config().plugins['odk.source.weread'])
    const preserved = () => {
      assert.deepEqual(config().plugins['odk.source.weread'], peer)
      assert.deepEqual(config().plugins['odk.tile.clock'], { enabled: false })
      assert.equal(config().plugins[id].enabled, true)
    }
    const launch = async (version, cached = true) => {
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_WEREAD_FIXTURE_PROFILE: profile, ODK_WEREAD_SURFACE_REPLACEMENT: '1',
        ODK_WEREAD_SURFACE_NATIVE: '1', ODK_WEREAD_SURFACE_REVISION: version, ODK_WEREAD_PERSISTENT_CACHE: cacheFile,
        ODK_WEREAD_CACHE_ONLY: cached ? '1' : '0' }
      delete childEnv.ELECTRON_RUN_AS_NODE
      try {
        const result = await runCommand(require('electron'), [`--user-data-dir=${profile}`, path.join(__dirname, 'weread-plugin-electron.cjs')],
          { env: childEnv, signal: t.signal, timeout: surfaceTimeouts().child, maxBuffer: 4 * 1024 * 1024 })
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.surfaceProcessRestart, true)
        assert.equal(report.surfaceVersion, version)
        assert.equal(report.independentSurface, version !== '1.0.0')
        assert.equal(report.signedIndependent, true, 'Surface removal retains the signed source')
        assert.equal(report.actualPreload, true)
        assert.equal(report.assetLeaseReleased, true)
        assert.equal(report.capturedSurfaceIntegrity, false, 'Revision acceptance must preserve stored revisions')
        assert.notEqual(report.pid, process.pid)
        assert.equal(pids.has(report.pid), false)
        pids.add(report.pid)
        assert.equal(report.consumers.length, 15)
        const { initial, initialProviderCalls, snapshot, providerCalls, primingProviderCalls, rendered, health } = report.cache
        assert.equal(initialProviderCalls, 0)
        assert.equal(snapshot.status, 'live')
        assert.equal(health.state, 'healthy')
        assert.equal(rendered.text, snapshot.highlight.markText)
        assert.equal(rendered.author, snapshot.highlight.author)
        assert.equal(rendered.coverHidden, true)
        if (cached) {
          assert.equal(initial.status, 'live')
          assert.equal(providerCalls, 0, 'Retained highlights must not require provider credentials')
          assert.equal(primingProviderCalls, 0, 'Default cached consumers must also avoid provider requests')
          assert.deepEqual(snapshot.highlight, cachedHighlight)
          assert.deepEqual(await fs.readFile(cacheFile), cacheBytes)
        } else {
          assert.ok(primingProviderCalls > 0)
          cachedHighlight = snapshot.highlight
          cacheBytes = await fs.readFile(cacheFile)
          assert.deepEqual(JSON.parse(cacheBytes).highlights[0], snapshot.highlight)
        }
        preserved()
        return report.consumers
      } finally { await fs.rm(profile, { recursive: true, force: true }) }
    }
    const first = config().plugins[id].native.revision
    const firstSnapshot = await native.store.snapshot(first)
    const baseline = await launch('2.0.0', false)
    const candidate = native.bundle('3.0.0')
    assert.equal(JSON.parse((await native.command(['update', id, candidate, '--keyring', policy, '--trust'])).stdout).effect, 'selection-only')
    const second = config().plugins[id].native.revision
    assert.notEqual(second, first)
    const secondSnapshot = await native.store.snapshot(second)
    assert.deepEqual(await launch('3.0.0'), baseline)
    const configBytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(candidate, 'entry.js'), '\nthrow Error("Unsigned surface update")')
    await assert.rejects(native.command(['update', id, candidate, '--keyring', policy, '--trust']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), configBytes)
    assert.equal(JSON.parse((await native.command(['rollback', id, '--keyring', policy])).stdout).effect, 'selection-only')
    assert.equal(config().plugins[id].native.revision, first)
    assert.deepEqual(await launch('2.0.0'), baseline)
    assert.equal(JSON.parse((await native.command(['remove', id])).stdout).effect, 'selection-only')
    assert.equal(config().plugins[id].native, undefined)
    assert.deepEqual(await launch('1.0.0'), baseline)
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.deepEqual([...(await source.store.snapshot(sourceRevision)).files], [...sourceSnapshot.files])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
