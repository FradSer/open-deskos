'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/weather-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')

test('actual Main bootstrap preserves signed Weather update rollback and restored default consumers', { timeout: 240000 }, async t => {
  const fixture = path.join(__dirname, 'weather-main-bootstrap.cjs')
  await fs.access(fixture)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weather-main-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
    ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
    ODK_WEATHER_LAT: '1', ODK_WEATHER_LON: '2', ODK_WEATHER_PLACE: 'Bootstrap place' }
  delete env.XDG_RUNTIME_DIR
  const enabled = new Set(['odk.source.weather', 'odk.system.renderer-development'])
  env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
  try {
    const native = await install(root, env, { signal: t.signal })
    const pids = new Set()
    const launch = async version => {
      const signed = version !== '1.0.0'
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_WEATHER_BOOTSTRAP_PROFILE: profile, ODK_WEATHER_BOOTSTRAP_VERSION: version }
      delete childEnv.ELECTRON_RUN_AS_NODE
      try {
        const running = execFile(require('electron'), [`--user-data-dir=${profile}`, fixture], {
          env: childEnv, signal: t.signal, killSignal: 'SIGKILL', timeout: 55000, maxBuffer: 1024 * 1024,
        })
        const closed = new Promise(resolve => running.child.once('close', resolve))
        let result
        try { result = await running } finally { await closed }
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.pid, running.child.pid)
        assert.equal(pids.has(report.pid), false, 'Each Main revision must start in an independent process')
        pids.add(report.pid)
        assert.equal(report.productionMain, true)
        assert.equal(report.actualPreload, true)
        assert.equal(report.version, version)
        assert.equal(report.executedVersion, version)
        assert.equal(report.defaultConstructions, signed ? 0 : 1)
        assert.equal(report.handlerReleased, true)
        assert.equal(report.hidden, true)
        assert.ok(report.providerCalls > 0)
        return report.consumer
      } finally { await fs.rm(profile, { recursive: true, force: true }) }
    }
    const first = native.config().plugins['odk.source.weather'].native.revision
    const firstSnapshot = await native.store.snapshot(first)
    const signed = await launch('2.0.0')
    const updatedBundle = native.bundle('3.0.0')
    await native.command(['update', 'odk.source.weather', updatedBundle, '--keyring', native.keyring,
      '--trust', '--grant', 'source.weather', '--grant', 'ipc'])
    const second = native.config().plugins['odk.source.weather'].native.revision
    const secondSnapshot = await native.store.snapshot(second)
    assert.notEqual(first, second)
    assert.deepEqual(await launch('3.0.0'), signed)
    const configBytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(updatedBundle, 'entry.cjs'), '\nthrow Error("Unsigned Main fixture update")')
    await assert.rejects(native.command(['update', 'odk.source.weather', updatedBundle, '--keyring', native.keyring,
      '--trust', '--grant', 'source.weather', '--grant', 'ipc']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), configBytes)
    await native.command(['rollback', 'odk.source.weather', '--keyring', native.keyring])
    assert.equal(native.config().plugins['odk.source.weather'].native.revision, first)
    assert.deepEqual(await launch('2.0.0'), signed)
    await native.command(['remove', 'odk.source.weather'])
    assert.deepEqual(await launch('1.0.0'), signed)
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
    assert.deepEqual(signed, { state: 'live', place: 'Bootstrap place', number: '24', unit: '°C', condition: 'Clear sky', low: '20°', high: '28°' })
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
