'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { createDeviceLocation, LOCATION_PROVIDER_URL, LOCATION_TIMEOUT_MS, LOCATION_REFRESH_MS } = require('../src/device-location')

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function located(overrides = {}) {
  return { success: true, latitude: 30.5928, longitude: 114.3055, city: 'Wuhan', ...overrides }
}

test('a keyless provider answer yields the device coordinates and city', async () => {
  const requests = []
  const location = createDeviceLocation({ fetchImpl: async (url) => { requests.push(String(url)); return response(located()) } })
  const found = await location.resolve()
  assert.equal(found.status, 'located')
  assert.equal(found.latitude, 30.5928)
  assert.equal(found.longitude, 114.3055)
  assert.equal(found.place, 'Wuhan')
  assert.equal(found.source, 'device')
  assert.equal(requests.length, 1)
  assert.equal(requests[0], LOCATION_PROVIDER_URL)
})

test('an answer without a city keeps the coordinates and invents no name', async () => {
  const location = createDeviceLocation({ fetchImpl: async () => response(located({ city: undefined })) })
  const found = await location.resolve()
  assert.equal(found.status, 'located')
  assert.equal(found.place, '')
  assert.equal(found.latitude, 30.5928)
})

test('a failed, timed-out, or nonsensical answer is unavailable with a reason', async () => {
  const cases = {
    'network error': async () => { throw new Error('socket hang up') },
    'http error': async () => response(located(), { ok: false, status: 503 }),
    'nonsense coordinates': async () => response({ success: true, latitude: 'north', longitude: 'west' }),
    'refused range': async () => response({ success: false, message: 'reserved range' }),
    'out-of-range coordinate': async () => response({ success: true, latitude: 500, longitude: 999, city: 'Nowhere' }),
    'not json': async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('invalid json') } }),
  }
  for (const [name, fetchImpl] of Object.entries(cases)) {
    const location = createDeviceLocation({ fetchImpl })
    const found = await location.resolve()
    assert.equal(found.status, 'unavailable', `${name} must not read as located`)
    assert.equal(found.latitude, null, `${name} must not publish a coordinate`)
    assert.equal(found.place, '', `${name} must not publish a place`)
    assert.ok(found.error, `${name} must carry a reason`)
  }
})

test('a slow provider is aborted at the deadline instead of delaying the desk', async () => {
  let aborted = false
  const location = createDeviceLocation({
    timeoutMs: 30,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    }),
  })
  const found = await location.resolve()
  assert.equal(aborted, true, `the request must be aborted within the ${LOCATION_TIMEOUT_MS} ms default budget`)
  assert.equal(found.status, 'unavailable')
  assert.match(found.error, /timed out after 30 ms/)
})

test('a location newer than the refresh interval is served from cache', async () => {
  let calls = 0
  let now = 1_000_000
  const location = createDeviceLocation({
    refreshMs: 60_000,
    now: () => now,
    fetchImpl: async () => { calls += 1; return response(located()) },
  })
  await location.resolve()
  now += 30_000
  await location.resolve()
  assert.equal(calls, 1, 'a fresh cached location must not call the provider again')
  now += 31_000
  await location.resolve()
  assert.equal(calls, 2, 'a stale cached location is refreshed')
})

test('concurrent resolutions share one in-flight request', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const location = createDeviceLocation({ fetchImpl: async () => { calls += 1; await gate; return response(located()) } })
  const resolutions = [location.resolve(), location.resolve(), location.resolve()]
  release()
  const found = await Promise.all(resolutions)
  assert.equal(calls, 1)
  assert.ok(found.every((value) => value.status === 'located'))
})

test('ODK_LOCATION_URL overrides the default endpoint', async () => {
  const previous = process.env.ODK_LOCATION_URL
  process.env.ODK_LOCATION_URL = 'https://geo.example.test/lookup'
  try {
    const requests = []
    const location = createDeviceLocation({ fetchImpl: async (url) => { requests.push(String(url)); return response(located()) } })
    await location.resolve()
    assert.deepEqual(requests, ['https://geo.example.test/lookup'])
  } finally {
    if (previous === undefined) delete process.env.ODK_LOCATION_URL
    else process.env.ODK_LOCATION_URL = previous
  }
})

test('ODK_LOCATION_REFRESH_MS bounds how long a located answer is reused', async () => {
  const previous = process.env.ODK_LOCATION_REFRESH_MS
  process.env.ODK_LOCATION_REFRESH_MS = '1000'
  try {
    let calls = 0
    let now = 5_000
    const location = createDeviceLocation({ now: () => now, fetchImpl: async () => { calls += 1; return response(located()) } })
    await location.resolve()
    now += 999
    await location.resolve()
    assert.equal(calls, 1)
    now += 2
    await location.resolve()
    assert.equal(calls, 2)
  } finally {
    if (previous === undefined) delete process.env.ODK_LOCATION_REFRESH_MS
    else process.env.ODK_LOCATION_REFRESH_MS = previous
  }
})

test('a zero refresh interval always re-queries instead of freezing the first answer', async () => {
  let calls = 0
  let now = 5_000
  const location = createDeviceLocation({ refreshMs: 0, now: () => now, fetchImpl: async () => { calls += 1; return response(located()) } })
  await location.resolve()
  now += 1
  await location.resolve()
  assert.equal(calls, 2, 'a zero interval means no caching, never an immortal answer')
})

test('the default provider and budget are documented constants', () => {
  assert.equal(LOCATION_PROVIDER_URL, 'https://ipwho.is/')
  assert.equal(LOCATION_TIMEOUT_MS, 3000)
  assert.equal(LOCATION_REFRESH_MS, 30 * 60 * 1000)
})