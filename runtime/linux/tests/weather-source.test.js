'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const FEATURE = fs.readFileSync(path.join(__dirname, 'features', 'weather-widget.feature'), 'utf8')
const { createWeatherSource, describeWeatherCode, WEATHER_STATES, placeColumns, PLACE_COLUMNS } = require('../src/weather-source')

function payload(overrides = {}) {
  return {
    current_units: { temperature_2m: '°C' },
    current: { temperature_2m: 24.8, weather_code: 2, time: '2026-09-18T02:00' },
    daily: { temperature_2m_max: [27.4], temperature_2m_min: [21.2] },
    ...overrides,
  }
}

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function temporaryCache(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-weather-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return path.join(directory, 'weather.json')
}

test('BDD feature states the provider, cache, and honest-state contract', () => {
  assert.match(FEATURE, /Feature: Weather instrument on the Home grid/)
  assert.match(FEATURE, /a Stale notice appears instead of a success badge/)
  assert.match(FEATURE, /no refresh time is displayed in any state/)
  assert.match(FEATURE, /its copy says the location is not set in the desk's own voice/)
  assert.match(FEATURE, /the snapshot carries the setting name for the Agent to act on/)
  assert.match(FEATURE, /it does not claim the source is unavailable/)
  assert.match(FEATURE, /the place is bounded and whitespace collapsed before it reaches the renderer/)
  assert.match(FEATURE, /concurrent refreshes share one in-flight request/)
  assert.match(FEATURE, /no state renders a temperature it cannot substantiate/)
})

test('maps WMO codes to the provider vocabulary the tile renders', () => {
  assert.deepEqual(describeWeatherCode(0), { condition: 'Clear sky', sky: 'sun' })
  assert.deepEqual(describeWeatherCode(2), { condition: 'Partly cloudy', sky: 'cloud' })
  assert.deepEqual(describeWeatherCode(3), { condition: 'Overcast', sky: 'cloud' })
  assert.deepEqual(describeWeatherCode(45), { condition: 'Fog', sky: 'cloud' })
  assert.deepEqual(describeWeatherCode(61), { condition: 'Slight rain', sky: 'rain' })
  assert.deepEqual(describeWeatherCode(75), { condition: 'Heavy snow', sky: 'snow' })
  assert.deepEqual(describeWeatherCode(95), { condition: 'Thunderstorm', sky: 'thunder' })
  assert.deepEqual(describeWeatherCode(1234), { condition: 'Unknown', sky: 'cloud' })
})

test('an unconfigured location performs no request and reports what to set', async () => {
  let calls = 0
  const source = createWeatherSource({ fetchImpl: async () => { calls += 1; return response(payload()) } })
  const snapshot = await source.refresh()
  assert.equal(calls, 0)
  assert.equal(snapshot.status, 'unconfigured')
  assert.equal(snapshot.current, null)
  assert.match(snapshot.hint, /ODK_WEATHER_LAT/)
})

test('a configured location yields a rounded reading with its own place name', async (t) => {
  const requests = []
  const source = createWeatherSource({
    latitude: 22.5431,
    longitude: 114.0579,
    place: 'Shenzhen',
    cacheFile: temporaryCache(t),
    fetchImpl: async (url) => { requests.push(String(url)); return response(payload()) },
  })
  const snapshot = await source.refresh()
  assert.equal(snapshot.status, 'live')
  assert.equal(snapshot.place, 'Shenzhen')
  assert.deepEqual(snapshot.current, { temperature: 25, unit: '°C', condition: 'Partly cloudy', sky: 'cloud', code: 2 })
  assert.deepEqual(snapshot.daily, { high: 27, low: 21 })
  assert.deepEqual(snapshot.hint, null)
  assert.equal(requests.length, 1)
  assert.match(requests[0], /latitude=22\.5431/)
  assert.match(requests[0], /longitude=114\.0579/)
  assert.match(requests[0], /timezone=auto/)
})

test('a reading younger than the interval is served from memory', async (t) => {
  let calls = 0
  let now = 1_000_000
  const source = createWeatherSource({
    latitude: 1, longitude: 2, place: 'Place', refreshMs: 60_000, now: () => now,
    cacheFile: temporaryCache(t),
    fetchImpl: async () => { calls += 1; return response(payload()) },
  })
  await source.refresh()
  now += 30_000
  await source.refresh()
  assert.equal(calls, 1)
  now += 31_000
  await source.refresh()
  assert.equal(calls, 2)
})

test('concurrent refreshes share one in-flight request', async (t) => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const source = createWeatherSource({
    latitude: 1, longitude: 2, place: 'Place', cacheFile: temporaryCache(t),
    fetchImpl: async () => { calls += 1; await gate; return response(payload()) },
  })
  const refreshes = [source.refresh(), source.refresh(), source.refresh()]
  release()
  const snapshots = await Promise.all(refreshes)
  assert.equal(calls, 1)
  assert.ok(snapshots.every((snapshot) => snapshot.status === 'live'))
})

test('a reading on disk is published at once while the provider read continues', async (t) => {
  const cacheFile = temporaryCache(t)
  let calls = 0
  const first = createWeatherSource({ latitude: 1, longitude: 2, place: 'Place', cacheFile, fetchImpl: async () => { calls += 1; return response(payload()) } })
  await first.refresh()
  const restarted = createWeatherSource({
    latitude: 1, longitude: 2, place: 'Place', cacheFile,
    fetchImpl: async () => { calls += 1; return response(payload({ current: { temperature_2m: 31, weather_code: 0 } })) },
  })
  const immediate = await restarted.refresh()
  assert.equal(immediate.status, 'stale', 'the cached reading is the first answer')
  assert.equal(immediate.current.temperature, 25)
  const refreshed = await restarted.refresh({ force: true })
  assert.equal(refreshed.status, 'live')
  assert.equal(refreshed.current.temperature, 31)
  assert.equal(calls, 2, 'the background read and the forced read share one request')
})

test('a provider failure keeps the cached reading and marks it stale', async (t) => {
  const cacheFile = temporaryCache(t)
  let fail = false
  const source = createWeatherSource({
    latitude: 1, longitude: 2, place: 'Place', cacheFile,
    fetchImpl: async () => {
      if (fail) throw new Error('network down')
      return response(payload())
    },
  })
  const first = await source.refresh()
  assert.equal(first.status, 'live')
  const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  assert.equal(cached.reading.current.temperature, 25)
  assert.equal(fs.statSync(cacheFile).mode & 0o777, 0o600)

  fail = true
  const second = await source.refresh({ force: true })
  assert.equal(second.status, 'stale')
  assert.deepEqual(second.current, first.current)
  assert.equal(second.updatedAt, first.updatedAt)
})

test('a restarted process serves the cached reading before any request', async (t) => {
  const cacheFile = temporaryCache(t)
  const first = createWeatherSource({ latitude: 1, longitude: 2, place: 'Place', cacheFile, fetchImpl: async () => response(payload()) })
  await first.refresh()
  const restarted = createWeatherSource({ latitude: 1, longitude: 2, place: 'Place', cacheFile, fetchImpl: async () => { throw new Error('offline') } })
  const snapshot = restarted.snapshot()
  assert.equal(snapshot.status, 'stale')
  assert.equal(snapshot.current.temperature, 25)
})

test('a failure with no cache is unavailable and names the provider, not the weather', async (t) => {
  const source = createWeatherSource({
    latitude: 1, longitude: 2, place: 'Place', cacheFile: temporaryCache(t),
    fetchImpl: async () => { throw new Error('socket hang up') },
  })
  const snapshot = await source.refresh()
  assert.equal(snapshot.status, 'unavailable')
  assert.equal(snapshot.current, null)
  assert.match(snapshot.error, /socket hang up/)
  assert.equal(snapshot.place, 'Place')
})

test('malformed, out-of-range, and non-OK payloads are rejected instead of rendered', async (t) => {
  const cases = {
    'http error': async () => response(payload(), { ok: false, status: 503 }),
    'not json': async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('invalid json') } }),
    'missing current': async () => response(payload({ current: undefined })),
    'missing daily': async () => response(payload({ daily: {} })),
    'non-numeric temperature': async () => response(payload({ current: { temperature_2m: 'warm', weather_code: 2 } })),
    'absurd temperature': async () => response(payload({ current: { temperature_2m: 9999, weather_code: 2 } })),
  }
  for (const [name, fetchImpl] of Object.entries(cases)) {
    const source = createWeatherSource({ latitude: 1, longitude: 2, place: 'Place', cacheFile: temporaryCache(t), fetchImpl })
    const snapshot = await source.refresh()
    assert.equal(snapshot.status, 'unavailable', `${name} must not read as live`)
    assert.equal(snapshot.current, null, `${name} must not render a temperature`)
  }
})

test('a slow provider is aborted at the deadline instead of hanging the desk', async (t) => {
  let aborted = false
  const source = createWeatherSource({
    latitude: 1, longitude: 2, place: 'Place', cacheFile: temporaryCache(t), timeoutMs: 30,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    }),
  })
  const snapshot = await source.refresh()
  assert.equal(aborted, true)
  assert.equal(snapshot.status, 'unavailable')
})

test('the place label is bounded, collapsed, and never carries control characters', async (t) => {
  const cases = [
    ['Shenzhen', 'Shenzhen'],
    ['  Shenzhen   Bay  ', 'Shenzhen Bay'],
    ['Shenzhen\u0007\nBay', 'Shenzhen Bay'],
    ['深圳', '深圳'],
    ['San Francisco', 'San Francisco'],
    ['深圳市南山区粤海街道', '深圳市南山区粤海街道'],
    ['a'.repeat(21), null],
    ['深'.repeat(11), null],
    ['深圳市南山区粤海街道科技园南区', null],
    ['a'.repeat(120), null],
    ['深'.repeat(40), null],
  ]
  for (const [configured, expected] of cases) {
    const source = createWeatherSource({ latitude: 22.5431, longitude: 114.0579, place: configured, cacheFile: temporaryCache(t), fetchImpl: async () => response(payload()) })
    const snapshot = await source.refresh()
    if (expected === null) assert.equal(snapshot.place, '22.54, 114.06', `${configured.slice(0, 12)}… must fall back to coordinates`)
    else assert.equal(snapshot.place, expected)
    assert.ok(placeColumns(snapshot.place) <= PLACE_COLUMNS, `published place ${snapshot.place} exceeds the tile bound`)
  }
})

test('a cached place is bounded when it is loaded again', async (t) => {
  const cacheFile = temporaryCache(t)
  fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, reading: {
    place: 'x'.repeat(200),
    current: { temperature: 20, unit: '°C', code: 2, condition: 'Partly cloudy', sky: 'sun-cloud' },
    daily: { high: 24, low: 18 },
    updatedAt: 1,
  } }), { mode: 0o600 })
  const source = createWeatherSource({ latitude: 22.5431, longitude: 114.0579, place: 'Shenzhen', cacheFile })
  const snapshot = source.snapshot()
  assert.equal(snapshot.status, 'stale')
  assert.ok(placeColumns(snapshot.place) <= PLACE_COLUMNS, `cached place must be bounded, got ${snapshot.place}`)
})

test('the tile never shows Live without a reading', () => {
  const tile = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.js'), 'utf8')
  assert.match(tile, /reported === 'live' && !reading \? 'unavailable' : reported/,
    'a live snapshot without a current reading must fall back to unavailable')
  assert.match(tile, /const reading = snapshot\?\.current \|\| null/)
})

test('a missing reading still names the instrument unit', async (t) => {
  const unavailable = createWeatherSource({ latitude: 1, longitude: 2, place: 'Place', cacheFile: temporaryCache(t), fetchImpl: async () => { throw new Error('offline') } })
  assert.equal((await unavailable.refresh()).unit, '°C')
  assert.equal((await createWeatherSource({ latitude: null, longitude: null }).refresh()).unit, '°C')
  const live = createWeatherSource({ latitude: 1, longitude: 2, place: 'Place', cacheFile: temporaryCache(t), fetchImpl: async () => response(payload()) })
  assert.equal((await live.refresh()).unit, '°C')
})

test('every state the source can publish is one the tile can render', () => {
  assert.deepEqual([...WEATHER_STATES].sort(), ['live', 'stale', 'unavailable', 'unconfigured'])
})