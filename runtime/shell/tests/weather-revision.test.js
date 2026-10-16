'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { install } = require('./helpers/weather-selection')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createWeatherSource } = require('../src/weather-source')
const { createShellOdkData } = require('../src/odk-data')
const { resolveConfigPath, updateConfig } = require('../src/plugin-config')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { healthPort } = require('../src/plugins/health')
const id = 'odk.source.weather'
const now = 1791504000000

for (const mode of ['cached', 'live']) test(`signed Weather ${mode} consumers survive update rollback and removal`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-weather-revisions-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const cacheFile = path.join(root, 'weather.json')
  const reading = { place: 'Saved English 与中文', updatedAt: now,
    current: { temperature: 21, unit: '°C', code: 2, condition: 'Partly cloudy', sky: 'cloud' }, daily: { high: 25, low: 18 } }
  fs.writeFileSync(cacheFile, JSON.stringify({ version: 2, location: { latitude: 1, longitude: 2 }, reading }))
  let active
  let calls = 0
  const options = { cacheFile, now: () => now, latitude: 1, longitude: 2, place: reading.place,
    fetchImpl: async url => {
      calls++
      assert.equal(new URL(url).searchParams.get('latitude'), '1')
      assert.equal(new URL(url).searchParams.get('longitude'), '2')
      if (mode === 'cached') throw Error('Controlled offline provider')
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({
        current_units: { temperature_2m: '°C' }, current: { temperature_2m: 21.3, weather_code: 2 },
        daily: { temperature_2m_max: [25], temperature_2m_min: [18] },
      }) }
    } }
  try {
    const native = await install(root, env)
    assert.equal(typeof native.bundle, 'function', 'Revision acceptance needs distinct signed bundles')
    updateConfig(resolveConfigPath(env), config => ({ ...config, plugins: { ...config.plugins,
      [id]: { ...config.plugins[id], enabled: true }, 'odk.tile.clock': { enabled: false } } }))
    const peer = structuredClone(native.config().plugins['odk.tile.clock'])
    const open = async version => {
      const replacements = await native.load()
      assert.equal(replacements.length, version === '1.0.0' ? 0 : 1)
      const handlers = new Map()
      let created = 0
      const host = createPluginHost({ capabilities: {
        ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
        'source.weather': { options, create(configuration) {
          assert.equal(version, '1.0.0', 'Signed source cannot call the default constructor')
          created++
          return createWeatherSource(configuration)
        } },
        'desk.data': { create: createShellOdkData, smokeMode: true },
      } })
      active = { host, handlers }
      createMainPlugins({ replacementPlugins: replacements }).filter(plugin => [id, 'odk.system.data'].includes(plugin.manifest.id))
        .forEach(plugin => host.register(plugin))
      await host.start()
      assert.equal(host.list().find(record => record.manifest.id === id).manifest.version, version)
      assert.equal(host.get(DATA_PORTS.weather).fixtureRevision, version === '1.0.0' ? undefined : version)
      assert.equal(created, version === '1.0.0' ? 1 : 0)
      await host.get(DATA_PORTS.weather).refresh({ force: true })
    }
    const consumers = async () => ({ ipc: await active.handlers.get('odk-weather-status')(null, { force: false }),
      reading: await active.host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.weather' }),
      health: active.host.get(healthPort(id)).snapshot() })
    const preserved = () => {
      assert.deepEqual(native.config().plugins['odk.tile.clock'], peer)
      assert.equal(native.config().plugins[id].enabled, true)
    }
    const restart = async version => {
      await active.host.stop()
      assert.equal(active.handlers.size, 0)
      assert.equal(active.host.list().some(record => ['cleanup-failed', 'cleanup-blocked'].includes(record.state)), false)
      await open(version)
      assert.deepEqual(await consumers(), baseline)
      assert.deepEqual(fs.readFileSync(cacheFile), cacheBytes)
      preserved()
    }
    await open('2.0.0')
    const baseline = await consumers()
    const cacheBytes = fs.readFileSync(cacheFile)
    const first = native.config().plugins[id].native.revision
    const bundle = native.bundle('3.0.0')
    let running = active.host.get(DATA_PORTS.weather)
    const update = await native.command(['update', id, bundle, '--keyring', native.keyring, '--trust', '--grant', 'source.weather', '--grant', 'ipc'])
    assert.equal(JSON.parse(update.stdout).effect, 'selection-only')
    const second = native.config().plugins[id].native.revision
    assert.notEqual(second, first)
    assert.equal(active.host.get(DATA_PORTS.weather), running)
    assert.deepEqual(await consumers(), baseline)
    await restart('3.0.0')
    running = active.host.get(DATA_PORTS.weather)
    const configBytes = fs.readFileSync(resolveConfigPath(env))
    fs.appendFileSync(path.join(bundle, 'entry.cjs'), '\nthrow Error("Unsigned fixture update")')
    await assert.rejects(native.command(['update', id, bundle, '--keyring', native.keyring, '--trust', '--grant', 'source.weather', '--grant', 'ipc']), /native file hash mismatch/)
    assert.deepEqual(fs.readFileSync(resolveConfigPath(env)), configBytes)
    assert.equal(active.host.get(DATA_PORTS.weather), running)
    assert.deepEqual(await consumers(), baseline)
    assert.equal(JSON.parse((await native.command(['rollback', id, '--keyring', native.keyring])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native.revision, first)
    assert.equal(active.host.get(DATA_PORTS.weather), running)
    assert.deepEqual(await consumers(), baseline)
    await restart('2.0.0')
    running = active.host.get(DATA_PORTS.weather)
    assert.equal(JSON.parse((await native.command(['remove', id])).stdout).effect, 'selection-only')
    assert.equal(native.config().plugins[id].native, undefined)
    assert.equal(active.host.get(DATA_PORTS.weather), running)
    assert.deepEqual(await consumers(), baseline)
    await restart('1.0.0')
    assert.equal((await native.store.read(first)).manifest.version, '2.0.0')
    assert.equal((await native.store.read(second)).manifest.version, '3.0.0')
    if (mode === 'live') assert.equal(calls, 4, 'Each composed source forces one refresh; fresh consumer reads avoid extra requests')
    assert.equal(baseline.ipc.status, mode === 'live' ? 'live' : 'stale')
    assert.equal(baseline.reading.reading.state, mode === 'live' ? 'live' : 'stale')
  } finally {
    try { await active?.host.stop() } finally { fs.rmSync(root, { recursive: true, force: true }) }
  }
})
