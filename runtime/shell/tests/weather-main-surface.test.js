'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { install } = require('./helpers/weather-selection')
const { prepare } = require('./helpers/weather-surface-selection')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const id = 'odk.tile.weather'

test('actual Main jointly starts signed Weather source and surface across revision transitions', { timeout: 180000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weather-main-surface-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
    ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
    ODK_WEATHER_LAT: '1', ODK_WEATHER_LON: '2', ODK_WEATHER_PLACE: 'Bootstrap place' }
  delete env.XDG_RUNTIME_DIR
  const enabled = new Set(['odk.source.weather', 'odk.system.renderer-development'])
  env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
  const pids = new Set()
  try {
    const source = await install(root, env, { signal: t.signal })
    const sourceRevision = source.config().plugins['odk.source.weather'].native.revision
    const sourceSnapshot = await source.store.snapshot(sourceRevision)
    const directory = path.join(root, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/weather-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.weather').lifecycle.mount = () => { throw Error('Default Weather mount refused in independent surface acceptance') }\n")
    const surface = await prepare(root, env, directory, { signal: t.signal })
    const policy = path.join(root, 'publishers.json')
    await fs.writeFile(policy, JSON.stringify({ schemaVersion: 1, publishers: {
      ...JSON.parse(await fs.readFile(source.keyring)).publishers,
      ...JSON.parse(await fs.readFile(surface.keyring)).publishers,
    } }))
    env.ODK_NATIVE_KEYRING = policy
    const config = () => readConfig(resolveConfigPath(env))
    const sourcePreference = structuredClone(config().plugins['odk.source.weather'])
    const launch = async version => {
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_WEATHER_BOOTSTRAP_PROFILE: profile,
        ODK_WEATHER_BOOTSTRAP_VERSION: '2.0.0', ODK_WEATHER_BOOTSTRAP_SURFACE_VERSION: version }
      delete childEnv.ELECTRON_RUN_AS_NODE
      try {
        const result = await runCommand(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'weather-main-bootstrap.cjs')]),
          { env: childEnv, signal: t.signal, timeout: 55000, maxBuffer: 1024 * 1024 })
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.productionMain, true)
        assert.equal(report.actualPreload, true)
        assert.equal(report.version, '2.0.0')
        assert.equal(report.executedVersion, '2.0.0')
        assert.equal(report.defaultConstructions, 0)
        assert.equal(report.surface.version, version)
        assert.equal(report.surface.executedVersion, version === '1.0.0' ? null : version)
        assert.equal(report.surface.marker, version === '1.0.0' ? null : 'independent-weather')
        assert.equal(report.surface.entries, version === '1.0.0' ? 0 : 1)
        assert.equal(report.surface.protocolActive, version !== '1.0.0')
        assert.equal(report.surface.released, true)
        assert.equal(report.handlerReleased, true)
        assert.equal(report.hidden, true)
        assert.ok(report.providerCalls > 0)
        assert.notEqual(report.pid, process.pid)
        assert.equal(pids.has(report.pid), false)
        pids.add(report.pid)
        assert.deepEqual(config().plugins['odk.source.weather'], sourcePreference)
        return report.consumer
      } finally { await fs.rm(profile, { recursive: true, force: true }) }
    }
    const first = config().plugins[id].native.revision
    const firstSnapshot = await surface.store.snapshot(first)
    const baseline = await launch('2.0.0')
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
    assert.deepEqual(baseline, { state: 'live', place: 'Bootstrap place', number: '24', unit: '°C', condition: 'Clear sky', low: '20°', high: '28°' })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
