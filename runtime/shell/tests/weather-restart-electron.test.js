'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/weather-selection')
const { resolveConfigPath } = require('../src/plugin-config')
const id = 'odk.source.weather'

test('signed Weather update rollback and removal preserve separate Electron consumers', { timeout: 180000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weather-process-revisions-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const pids = new Set()
  const cacheFile = path.join(root, 'persistent-weather.json')
  let cacheBytes
  let cachedReading
  try {
    const native = await install(root, env)
    const launch = async (version, offline = false) => {
      const profile = await fs.mkdtemp(path.join(root, 'electron-'))
      const childEnv = { ...env, ODK_WEATHER_FIXTURE_PROFILE: profile, ODK_WEATHER_RESTART_VERSION: version,
        ODK_WEATHER_PERSISTENT_CACHE: cacheFile, ODK_WEATHER_CACHE_OFFLINE: offline ? '1' : '0' }
      delete childEnv.ELECTRON_RUN_AS_NODE
      try {
        const fixture = path.join(__dirname, 'weather-plugin-electron.cjs')
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
        assert.ok(report.cache, 'Each actual source must consume the persistent cache')
        assert.equal(report.cache.initialProviderCalls, 0, 'Cache loads before provider acquisition')
        const { initial, snapshot, rendered, health } = report.cache
        const reading = { place: snapshot.place, unit: snapshot.unit, current: snapshot.current,
          daily: snapshot.daily, updatedAt: snapshot.updatedAt }
        if (offline) {
          assert.equal(initial.status, 'stale')
          assert.deepEqual(initial.current, cachedReading.current)
          assert.deepEqual(reading, cachedReading)
          assert.deepEqual(await fs.readFile(cacheFile), cacheBytes)
        } else {
          assert.equal(initial.current, null, 'Initial source must obtain the persistent reading from the provider')
          cacheBytes = await fs.readFile(cacheFile)
          cachedReading = reading
          const stored = JSON.parse(cacheBytes)
          assert.deepEqual(stored.location, { latitude: 1, longitude: 2 })
          assert.deepEqual(stored.reading.current, snapshot.current)
        }
        assert.equal(snapshot.status, offline ? 'stale' : 'live')
        assert.equal(snapshot.error, offline ? 'Controlled provider unavailable' : null)
        assert.equal(rendered.state, offline ? 'stale' : 'live')
        assert.equal(rendered.number, '-100')
        assert.equal(rendered.unit, '°C')
        assert.equal(rendered.place, 'English 与中文地点')
        assert.equal(rendered.condition, snapshot.current.condition)
        assert.equal(rendered.glyph, `weather-${snapshot.current.sky}`)
        assert.equal(rendered.low, '-100°')
        assert.equal(rendered.high, '100°')
        assert.equal(rendered.badge, offline ? 'Stale' : '')
        assert.equal(health.state, offline ? 'degraded' : 'healthy')
        return report.consumers
      } finally { await fs.rm(profile, { recursive: true, force: true }) }
    }
    const first = native.config().plugins[id].native.revision
    const firstSnapshot = await native.store.snapshot(first)
    const baseline = await launch('2.0.0')
    const bundle = native.bundle('3.0.0')
    const update = await native.command(['update', id, bundle, '--keyring', native.keyring, '--trust', '--grant', 'source.weather', '--grant', 'ipc'])
    assert.equal(JSON.parse(update.stdout).effect, 'selection-only')
    const second = native.config().plugins[id].native.revision
    const secondSnapshot = await native.store.snapshot(second)
    assert.notEqual(first, second)
    assert.deepEqual(await launch('3.0.0', true), baseline)
    const configBytes = await fs.readFile(resolveConfigPath(env))
    await fs.appendFile(path.join(bundle, 'entry.cjs'), '\nthrow Error("Unsigned process fixture update")')
    await assert.rejects(native.command(['update', id, bundle, '--keyring', native.keyring, '--trust', '--grant', 'source.weather', '--grant', 'ipc']), /native file hash mismatch/)
    assert.deepEqual(await fs.readFile(resolveConfigPath(env)), configBytes)
    assert.equal(JSON.parse((await native.command(['rollback', id, '--keyring', native.keyring])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native.revision, first)
    assert.deepEqual(await launch('2.0.0', true), baseline)
    assert.equal(JSON.parse((await native.command(['remove', id])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native, undefined)
    assert.deepEqual(await launch('1.0.0', true), baseline)
    assert.equal(pids.size, 4)
    assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
    assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
