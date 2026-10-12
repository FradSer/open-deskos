'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createWeatherSource } = require('../src/weather-source')
const { createShellOdkData } = require('../src/odk-data')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { healthPort } = require('../src/plugins/health')
const { install } = require('./helpers/weather-selection')
const run = promisify(execFile)
const replacementDirectory = path.join(__dirname, 'fixtures/weather-replacement')
const cli = path.join(__dirname, '../scripts/odk-plugin-cli.js')
const timestamp = 1700000000000
const response = () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({
  current_units: { temperature_2m: '°C' }, current: { temperature_2m: 21.3, weather_code: 2 },
  daily: { temperature_2m_max: [25], temperature_2m_min: [18] },
}) })

test('independent Weather constructs when default source imports are refused', async () => {
  const file = path.join(replacementDirectory, 'source.cjs')
  const localRequire = createRequire(file)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, process, AbortController, AbortSignal, setTimeout, clearTimeout,
    require(name) {
      assert.notEqual(localRequire.resolve(name), path.resolve(__dirname, '../src/weather-source.js'), 'Independent source cannot import the default source')
      return localRequire(name)
    },
  })
  const source = module.exports.createWeatherSource({ latitude: null, longitude: null, fetchImpl() { throw Error('Pinned source cannot request a provider') } })
  assert.equal((await source.refresh()).status, 'unconfigured')
  await source.stop()
})

async function fixture(t, replacement, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-wparity-'))
  options = { ...options, cacheFile: path.join(root, 'weather.json') }
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  let host
  t.after(async () => { try { await host?.stop() } finally { fs.rmSync(root, { recursive: true, force: true }) } })
  let replacements = []
  let native
  if (replacement === 'signed') {
    native = await install(root, env)
    replacements = await native.load()
    assert.equal(replacements.length, 1)
    native.mutate()
  } else if (replacement) {
    await run(process.execPath, [cli, 'link', replacementDirectory, '--trust', '--replace', '--grant', 'source.weather', '--grant', 'ipc'], { env })
    replacements = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
    assert.equal(replacements.length, 1)
  }
  const handlers = new Map()
  const instances = []
  host = createPluginHost({ capabilities: {
    ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
    'source.weather': { options, create(configuration) {
      assert.equal(replacement, false, 'replacement must not call the built-in source factory')
      return createWeatherSource(configuration)
    } },
    'desk.data': { create: createShellOdkData, smokeMode: true },
  } })
  const plugins = createMainPlugins({ replacementPlugins: replacements })
  plugins.filter(plugin => ['odk.source.weather', 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.get(DATA_PORTS.weather).fixtureRevision, replacement === 'signed' ? '2.0.0' : undefined)
  assert.equal(host.list().find(record => record.manifest.id === 'odk.source.weather').manifest.version, replacement ? '2.0.0' : '1.0.0')
  instances.push(host.get(DATA_PORTS.weather))
  return { host, handlers, instances, root, env,
    ipc: force => handlers.get('odk-weather-status')(null, { force }),
    read: () => host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.weather' }),
    health: () => host.get(healthPort('odk.source.weather')).snapshot(),
  }
}

for (const replacement of [false, true, 'signed']) {
  const implementation = replacement === 'signed' ? 'signed independent Weather plugin' : replacement ? 'linked independent Weather plugin' : 'default Weather plugin'
  test(`${implementation} publishes relocation through IPC and Open DeskOS Data with the correct cache identity`, async t => {
    let located = 0
    const pending = []
    const starts = []
    const started = [0, 1].map(index => new Promise(resolve => { starts[index] = resolve }))
    const f = await fixture(t, replacement, { locationProvider: { resolve: async () => {
      const second = located++ > 0
      return { status: 'located', latitude: second ? 3 : 1, longitude: second ? 4 : 2, place: second ? 'Second' : 'First' }
    } }, fetchImpl: (url, { signal }) => new Promise(resolve => {
      pending.push({ url: new URL(url), resolve })
      signal.addEventListener('abort', () => resolve(response()), { once: true })
      starts[pending.length - 1]()
    }) })
    const first = f.ipc(true)
    await started[0]
    const second = f.ipc(true)
    // The provider promise continuation runs after the second location continuation.
    pending[0].resolve(response())
    assert.equal((await first).current, null)
    assert.equal(fs.existsSync(path.join(f.root, 'weather.json')), false)
    await started[1]
    assert.equal(pending[1].url.searchParams.get('latitude'), '3')
    pending[1].resolve(response())
    assert.equal((await second).place, 'Second')
    assert.equal((await f.read()).reading.value.place, 'Second')
    assert.equal(f.health().state, 'healthy')
    const cache = JSON.parse(fs.readFileSync(path.join(f.root, 'weather.json'), 'utf8'))
    assert.deepEqual(cache.location, { latitude: 3, longitude: 4 })
    assert.equal(cache.reading.place, 'Second')
  })

  test(`${implementation} preserves live, stale, unavailable, and unconfigured consumer contracts`, async t => {
    let failed = true
    let calls = 0
    const f = await fixture(t, replacement, { latitude: 1, longitude: 2, place: 'Place', now: () => timestamp,
      fetchImpl: async () => { calls++; if (failed) throw Error('offline'); return response() },
    })
    assert.equal(f.health().state, 'failed')
    assert.equal(calls, 0, 'health reads only cached state')
    assert.equal((await f.ipc(true)).status, 'unavailable')
    assert.equal((await f.read()).reading.value, null)
    failed = false
    const live = await f.ipc(true)
    const reading = (await f.read()).reading
    assert.equal(live.status, 'live')
    assert.equal(live.unit, '°C')
    assert.equal(reading.id, 'odk.tile.weather')
    assert.equal(reading.state, 'live')
    assert.deepEqual(reading.value, { asOf: new Date(timestamp).toISOString(), place: 'Place', temperatureC: 21, condition: 'Partly cloudy', highC: 25, lowC: 18 })
    assert.equal(f.health().state, 'healthy')
    const cachedCalls = calls
    assert.equal((await f.ipc(false)).status, 'live')
    assert.equal(calls, cachedCalls)
    failed = true
    assert.equal((await f.ipc(true)).status, 'stale')
    assert.equal(f.health().state, 'degraded')
    const stale = (await f.read()).reading
    assert.equal(stale.state, 'stale')
    assert.deepEqual(stale.value, reading.value)
    const initial = f.instances[0]
    await f.host.setEnabled('odk.source.weather', false)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.host.get(DATA_PORTS.weather), null)
    assert.equal(f.host.get(DESK_PORTS.data).registry.list().some(entry => entry.id === 'odk.tile.weather'), false)
    await f.host.setEnabled('odk.source.weather', true)
    assert.notEqual(f.host.get(DATA_PORTS.weather), initial)
    assert.equal(f.host.get(DATA_PORTS.weather).snapshot().status, 'stale')
    assert.deepEqual((await f.read()).reading.value, reading.value)
    assert.equal(f.host.get(DESK_PORTS.data).registry.list().some(entry => entry.id === 'odk.tile.weather'), true)
    await f.host.stop()
    const unconfigured = await fixture(t, replacement, { latitude: null, longitude: null,
      fetchImpl() { throw Error('unconfigured source must not use network') },
    })
    assert.equal((await unconfigured.ipc(true)).status, 'unconfigured')
    const missing = (await unconfigured.read()).reading
    assert.equal(missing.state, 'unconfigured')
    assert.equal(missing.value, null)
    assert.equal(unconfigured.health().state, 'degraded')
  })

  test(`${implementation} drains cancellation before another instance starts`, async t => {
    let resolveFetch
    let entered
    const ready = new Promise(resolve => { entered = resolve })
    let signal
    let updates = 0
    const f = await fixture(t, replacement, { latitude: 1, longitude: 2, onUpdate() { updates++ },
      fetchImpl: (_url, options) => { signal = options.signal; entered(); return new Promise(resolve => { resolveFetch = resolve }) },
    })
    const source = f.host.get(DATA_PORTS.weather)
    const refresh = f.ipc(true)
    await ready
    const disable = f.host.setEnabled('odk.source.weather', false)
    assert.equal(signal.aborted, true)
    let enabled = false
    const enable = f.host.setEnabled('odk.source.weather', true).then(() => { enabled = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(enabled, false, 'replacement waits for retained resources')
    resolveFetch(response())
    await Promise.all([refresh, disable, enable])
    assert.equal(updates, 0)
    assert.notEqual(f.host.get(DATA_PORTS.weather), source)
    assert.equal(f.handlers.size, 1)
  })

  test(`${implementation} retains resources after failed cleanup and retries before replacement`, async t => {
    const f = await fixture(t, replacement, { latitude: null, longitude: null })
    const source = f.host.get(DATA_PORTS.weather)
    const stop = source.stop.bind(source)
    let failed = true
    source.stop = () => { if (failed) throw Error('fixture close failed'); return stop() }
    await f.host.setEnabled('odk.source.weather', false)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.source.weather').state, 'cleanup-failed')
    await f.host.setEnabled('odk.source.weather', true)
    assert.equal(f.host.get(DATA_PORTS.weather), null)
    assert.equal(f.handlers.size, 0)
    failed = false
    await f.host.setEnabled('odk.source.weather', true)
    assert.notEqual(f.host.get(DATA_PORTS.weather), source)
    assert.equal(f.handlers.size, 1)
  })
}

test('removing the independent Weather link restores the default without changing the source package', async t => {
  const f = await fixture(t, true, { latitude: null, longitude: null })
  const entry = path.join(replacementDirectory, 'entry.cjs')
  const bytes = fs.readFileSync(entry)
  await f.host.stop()
  await run(process.execPath, [cli, 'remove', 'odk.source.weather'], { env: f.env })
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.deepEqual(fs.readFileSync(entry), bytes)
  assert.equal(createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather').manifest.version, '1.0.0')
  let created = 0
  const restored = createPluginHost({ capabilities: {
    ipc: { handle() {}, removeHandler() {} },
    'source.weather': { create(options) { created++; return createWeatherSource(options) }, options: { latitude: null, longitude: null } },
  } })
  t.after(() => restored.stop())
  restored.register(createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather'))
  await restored.start()
  assert.equal(created, 1)
  assert.equal((await restored.get(DATA_PORTS.weather).refresh()).status, 'unconfigured')
})
