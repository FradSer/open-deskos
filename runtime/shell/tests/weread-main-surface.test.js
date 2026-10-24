'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { install } = require('./helpers/weread-selection')
const { prepare } = require('./helpers/weread-surface-selection')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { createMainPlugins } = require('../src/plugins/main-composition')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const id = 'odk.tile.weread'

test('actual Main jointly starts signed WeRead source and surface across revision transitions', { timeout: 180000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weread-main-surface-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
    ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
    ODK_WEREAD_BOOTSTRAP_MODE: 'live', ODK_WEREAD_BOOTSTRAP_CACHE: path.join(root, 'highlights.json') }
  delete env.XDG_RUNTIME_DIR
  const enabled = new Set(['odk.source.weread', 'odk.system.renderer-development'])
  env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
  const pids = new Set()
  try {
    const source = await install(root, env, { signal: t.signal })
    const sourceRevision = source.config().plugins['odk.source.weread'].native.revision
    const sourceSnapshot = await source.store.snapshot(sourceRevision)
    const directory = path.join(root, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/weread-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.weread').lifecycle.mount = () => { throw Error('Default WeRead mount refused in independent surface acceptance') }\n")
    const surface = await prepare(root, env, directory, { signal: t.signal })
    const policy = path.join(root, 'publishers.json')
    await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {
      ...JSON.parse(await fs.readFile(source.keyring)).publishers,
      ...JSON.parse(await fs.readFile(surface.keyring)).publishers,
    } }))
    env.ODK_NATIVE_KEYRING = policy
    const config = () => readConfig(resolveConfigPath(env))
    const sourcePreference = structuredClone(config().plugins['odk.source.weread'])
    const launch = async version => {
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_WEREAD_BOOTSTRAP_PROFILE: profile,
        ODK_WEREAD_BOOTSTRAP_VERSION: '2.0.0', ODK_WEREAD_BOOTSTRAP_SURFACE_VERSION: version }
      delete childEnv.ELECTRON_RUN_AS_NODE
      const operation = execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'weread-main-bootstrap.cjs')]),
        { env: childEnv, signal: t.signal, timeout: 55000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
      const closed = new Promise(resolve => operation.child.once('close', resolve))
      try {
        const result = await operation
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.productionMain, true)
        assert.equal(report.actualPreload, true)
        assert.equal(report.version, '2.0.0')
        assert.equal(report.executedVersion, '2.0.0')
        assert.equal(report.defaultConstructions, 0)
        assert.equal(report.surface.version, version)
        assert.equal(report.surface.executedVersion, version === '1.0.0' ? null : version)
        assert.equal(report.surface.marker, version === '1.0.0' ? null : 'independent-weread')
        assert.equal(report.surface.entries, version === '1.0.0' ? 0 : 1)
        assert.equal(report.surface.protocolActive, version !== '1.0.0')
        assert.equal(report.surface.released, true)
        assert.equal(report.handlersReleased, true)
        assert.equal(report.hidden, true)
        assert.equal(report.apiCalls, pids.size === 0 ? 2 : 0)
        assert.equal(report.coverCalls, 0)
        assert.equal(report.cacheLoaded, pids.size > 0)
        assert.equal(report.pid, operation.child.pid)
        assert.notEqual(report.pid, process.pid)
        assert.equal(pids.has(report.pid), false)
        pids.add(report.pid)
        assert.deepEqual(config().plugins['odk.source.weread'], sourcePreference)
        return { preload: report.consumer, rendered: Object.fromEntries(['text', 'title', 'author', 'date', 'coverHidden'].map(key => [key, report.surface[key]])) }
      } finally {
        await closed
        await fs.rm(profile, { recursive: true, force: true })
      }
    }
    const first = config().plugins[id].native.revision
    const firstSnapshot = await surface.store.snapshot(first)
    const baseline = await launch('2.0.0')
    const cacheBytes = await fs.readFile(env.ODK_WEREAD_BOOTSTRAP_CACHE)
    await surface.command(['update', id, surface.bundle('3.0.0'), '--keyring', policy, '--trust'])
    const second = config().plugins[id].native.revision
    const secondSnapshot = await surface.store.snapshot(second)
    assert.notEqual(first, second)
    assert.deepEqual(await launch('3.0.0'), baseline)
    await surface.command(['rollback', id, '--keyring', policy])
    assert.equal(config().plugins[id].native.revision, first)
    assert.deepEqual(await launch('2.0.0'), baseline)
    await surface.command(['remove', id])
    assert.equal(config().plugins[id].native, undefined)
    assert.deepEqual(await launch('1.0.0'), baseline)
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await surface.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await surface.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.deepEqual([...(await source.store.snapshot(sourceRevision)).files], [...sourceSnapshot.files])
    assert.equal(baseline.preload.status, 'live')
    assert.equal(baseline.preload.highlight.markText, 'Controlled highlight\n独立插件保持原文。')
    assert.deepEqual(await fs.readFile(env.ODK_WEREAD_BOOTSTRAP_CACHE), cacheBytes)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
