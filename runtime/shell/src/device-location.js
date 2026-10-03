'use strict'

/*
 * Device-location lookup for hosts that were not given a desk location.
 *
 * The CM5 is configured with ODK_WEATHER_LAT / ODK_WEATHER_LON, so this seam is
 * never opened there. A Windows handheld that travels has no such configuration,
 * so the Shell asks a keyless IP-geolocation provider where the device is and
 * reuses the answer for ODK_LOCATION_REFRESH_MS. Asking a third party where this
 * device is is a privacy tradeoff; the endpoint is overridable with
 * ODK_LOCATION_URL and the request is bounded so a dead provider cannot delay the
 * desk. The render path never reaches this module: only the async weather refresh
 * resolves a location.
 */

const LOCATION_PROVIDER_URL = 'https://ipwho.is/'
const LOCATION_TIMEOUT_MS = 3000
const LOCATION_REFRESH_MS = 30 * 60 * 1000

function coordinate(value, limit) {
  if (value === undefined || value === null || value === '') return null
  const number = Number.parseFloat(String(value))
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null
  return number
}

function readLocation(payload) {
  if (!payload || typeof payload !== 'object' || payload.success === false) return null
  let latitude = coordinate(payload.latitude, 90)
  let longitude = coordinate(payload.longitude, 180)
  // ipinfo.io answers with a `loc` of "lat,lon"; accept it so an operator can point
  // ODK_LOCATION_URL at more than one keyless provider without a code change.
  if ((latitude === null || longitude === null) && typeof payload.loc === 'string') {
    const [lat, lon] = payload.loc.split(',')
    latitude = coordinate(lat, 90)
    longitude = coordinate(lon, 180)
  }
  if (latitude === null || longitude === null) return null
  const place = typeof payload.city === 'string' ? payload.city : (typeof payload.town === 'string' ? payload.town : '')
  return { latitude, longitude, place }
}

function environmentRefreshMs() {
  const value = Number.parseInt(process.env.ODK_LOCATION_REFRESH_MS, 10)
  return Number.isFinite(value) && value > 0 ? value : LOCATION_REFRESH_MS
}

function createDeviceLocation(options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const now = options.now || (() => Date.now())
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : LOCATION_TIMEOUT_MS
  // An explicit interval wins, including 0 (always re-query); only an absent or
  // unusable interval falls back to the environment then the default.
  const refreshMs = Number.isFinite(options.refreshMs) ? options.refreshMs : environmentRefreshMs()
  const providerUrl = options.providerUrl || process.env.ODK_LOCATION_URL || LOCATION_PROVIDER_URL
  let located = null
  let inFlight = null

  async function request() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(providerUrl, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response?.ok) throw new Error(`location provider responded ${response?.status ?? 'without a status'}`)
      return readLocation(await response.json())
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`location provider timed out after ${timeoutMs} ms`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async function resolve({ force = false } = {}) {
    if (located && !force && now() - located.fetchedAt < refreshMs) {
      return { status: 'located', ...located, source: 'device' }
    }
    if (inFlight) return inFlight
    inFlight = (async () => {
      const stamp = now()
      try {
        const found = await request()
        if (!found) throw new Error('location provider returned no usable coordinates')
        located = { latitude: found.latitude, longitude: found.longitude, place: found.place, fetchedAt: stamp }
        return { status: 'located', ...located, source: 'device' }
      } catch (error) {
        // A failure is not cached: the next refresh may try again, and no coordinate
        // or city is ever invented for a lookup that did not succeed.
        return { status: 'unavailable', latitude: null, longitude: null, place: '', fetchedAt: null, source: null, error: error?.message || 'location provider unavailable' }
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return { resolve, snapshot: () => (located ? { ...located, source: 'device' } : null) }
}

module.exports = { createDeviceLocation, LOCATION_PROVIDER_URL, LOCATION_TIMEOUT_MS, LOCATION_REFRESH_MS }