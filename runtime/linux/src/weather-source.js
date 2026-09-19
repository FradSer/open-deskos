'use strict'

/*
 * Weather source for the Home instrument.
 *
 * The renderer never touches the network: the main process owns this seam, keeps a
 * bounded cache, and publishes exactly one of four states. A reading is only ever
 * shown when a provider returned it, so an outage degrades to `stale` or
 * `unavailable` instead of a plausible-looking number.
 */

const PROVIDER_URL = 'https://api.open-meteo.com/v1/forecast'
const CACHE_VERSION = 1
const REFRESH_MS = 10 * 60 * 1000
const TIMEOUT_MS = 8000
const TEMPERATURE_LIMIT = 100
// The provider speaks Celsius unless asked otherwise; the instrument publishes this unit
// in every state so a missing reading still reads as a temperature instrument.
const DEFAULT_UNIT = '°C'
// A place label has to survive one line in the narrowest 1x1 cell (about 170px at 12px
// text), so it is bounded in *display columns*: a wide (CJK) character costs two. A name
// that cannot fit falls back to the configured coordinates rather than wrapping, which
// would push the tile's rows past the density band. Whitespace collapses and control
// characters never reach the renderer.
const PLACE_COLUMNS = 20
const WEATHER_STATES = ['live', 'stale', 'unavailable', 'unconfigured']

/*
 * WMO weather codes in the provider's own wording. The condition line quotes a
 * provider string, so each label stays under 22 characters and never claims more
 * precision than the code carries.
 */
const WEATHER_CODES = {
  0: ['Clear sky', 'sun'],
  1: ['Mainly clear', 'sun'],
  2: ['Partly cloudy', 'cloud'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud'],
  48: ['Rime fog', 'cloud'],
  51: ['Light drizzle', 'rain'],
  53: ['Moderate drizzle', 'rain'],
  55: ['Dense drizzle', 'rain'],
  56: ['Light freezing drizzle', 'rain'],
  57: ['Dense freezing drizzle', 'rain'],
  61: ['Slight rain', 'rain'],
  63: ['Moderate rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Light freezing rain', 'rain'],
  67: ['Heavy freezing rain', 'rain'],
  71: ['Slight snow', 'snow'],
  73: ['Moderate snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light rain showers', 'rain'],
  81: ['Moderate rain showers', 'rain'],
  82: ['Violent rain showers', 'rain'],
  85: ['Light snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm with hail', 'thunder'],
  99: ['Thunderstorm with hail', 'thunder'],
}

function describeWeatherCode(code) {
  const entry = WEATHER_CODES[code]
  return entry ? { condition: entry[0], sky: entry[1] } : { condition: 'Unknown', sky: 'cloud' }
}

function coordinate(value, limit) {
  if (value === undefined || value === null || value === '') return null
  const number = Number.parseFloat(String(value))
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null
  return number
}

function placeColumns(value) {
  let columns = 0
  for (const character of value) columns += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(character) ? 2 : 1
  return columns
}

function boundPlace(value) {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return placeColumns(cleaned) > PLACE_COLUMNS ? '' : cleaned
}

function temperature(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return Math.abs(rounded) <= TEMPERATURE_LIMIT ? rounded : null
}

function oneOf(series) {
  if (!Array.isArray(series)) return null
  return temperature(series[0])
}

function createWeatherSource({
  fetchImpl = fetch,
  now = () => Date.now(),
  fsImpl = require('node:fs'),
  pathImpl = require('node:path'),
  cacheFile,
  latitude,
  longitude,
  place,
  refreshMs = REFRESH_MS,
  timeoutMs = TIMEOUT_MS,
  providerUrl = PROVIDER_URL,
} = {}) {
  // An explicitly passed value wins, including an explicit null: that is how a smoke
  // run asks for no location instead of inheriting the desk's configured one.
  const lat = coordinate(latitude !== undefined ? latitude : process.env.ODK_WEATHER_LAT, 90)
  const lon = coordinate(longitude !== undefined ? longitude : process.env.ODK_WEATHER_LON, 180)
  const placeOption = place !== undefined ? place : process.env.ODK_WEATHER_PLACE
  const namedPlace = boundPlace(placeOption)
  const configured = lat !== null && lon !== null
  let state = configured
    ? { status: 'unavailable', place: label(), unit: DEFAULT_UNIT, current: null, daily: null, updatedAt: null, hint: null, error: null }
    : { status: 'unconfigured', place: null, unit: DEFAULT_UNIT, current: null, daily: null, updatedAt: null, hint: 'Set ODK_WEATHER_LAT and ODK_WEATHER_LON', error: null }
  let inFlight = null

  function label() {
    if (namedPlace) return namedPlace
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`
  }

  loadCache()

  function loadCache() {
    if (!configured || !cacheFile) return
    try {
      const cached = JSON.parse(fsImpl.readFileSync(cacheFile, 'utf8'))
      const reading = cached?.reading
      if (cached?.version !== CACHE_VERSION || !reading || !reading.current) return
      if (temperature(reading.current.temperature) === null) return
      state = { status: 'stale', place: boundPlace(reading.place) || label(), unit: reading.current.unit || DEFAULT_UNIT, current: reading.current, daily: reading.daily || null,
        updatedAt: Number(reading.updatedAt) || null, hint: null, error: null }
    } catch {
      // A missing or corrupt cache is replaced by the next successful reading.
    }
  }

  function save(reading) {
    if (!cacheFile) return
    try {
      fsImpl.mkdirSync(pathImpl.dirname(cacheFile), { recursive: true })
      fsImpl.writeFileSync(cacheFile, JSON.stringify({ version: CACHE_VERSION, reading }), { mode: 0o600 })
    } catch {
      // A cache failure must not stop a live reading from displaying.
    }
  }

  function readPayload(payload) {
    const current = payload?.current
    const daily = payload?.daily
    const code = current?.weather_code
    const value = temperature(current?.temperature_2m)
    const high = oneOf(daily?.temperature_2m_max)
    const low = oneOf(daily?.temperature_2m_min)
    if (value === null || !Number.isInteger(code) || high === null || low === null) return null
    const unit = typeof payload?.current_units?.temperature_2m === 'string' ? payload.current_units.temperature_2m.slice(0, 4) : '°C'
    return {
      current: { temperature: value, unit, code, ...describeWeatherCode(code) },
      daily: { high, low },
    }
  }

  async function request() {
    const url = `${providerUrl}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`
      + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response?.ok) throw new Error(`provider responded ${response?.status ?? 'without a status'}`)
      const contentType = response.headers?.get?.('content-type') || ''
      if (contentType && !contentType.includes('json')) throw new Error(`provider responded ${contentType.split(';')[0]}`)
      return readPayload(await response.json())
    } finally {
      clearTimeout(timer)
    }
  }

  async function run() {
    const stamp = now()
    try {
      const reading = await request()
      if (!reading) throw new Error('provider payload was not a usable reading')
      state = { status: 'live', place: label(), unit: reading.current.unit || DEFAULT_UNIT, current: reading.current, daily: reading.daily, updatedAt: stamp, hint: null, error: null }
      save({ place: label(), current: reading.current, daily: reading.daily, updatedAt: stamp })
    } catch (error) {
      const message = error?.name === 'AbortError' ? `provider timed out after ${timeoutMs} ms` : (error?.message || 'provider unavailable')
      const kept = state.current
      state = kept
        ? { ...state, status: 'stale', error: message }
        : { status: 'unavailable', place: label(), unit: DEFAULT_UNIT, current: null, daily: null, updatedAt: state.updatedAt, hint: null, error: message }
    }
    return state
  }

  function begin() {
    if (inFlight) return inFlight
    inFlight = run().finally(() => { inFlight = null })
    return inFlight
  }

  function refresh({ force = false } = {}) {
    if (!configured) return Promise.resolve(state)
    if (inFlight) return inFlight
    if (!force && state.status === 'live' && state.updatedAt !== null && now() - state.updatedAt < refreshMs) {
      return Promise.resolve(state)
    }
    // A reading the desk already holds is published at once, with the provider read
    // continuing in the background: a restart must never present an empty instrument
    // while the last reading is on disk.
    if (!force && state.current) {
      void begin()
      return Promise.resolve(state)
    }
    return begin()
  }

  return { refresh, snapshot: () => state, configured }
}

module.exports = { createWeatherSource, describeWeatherCode, WEATHER_STATES, PROVIDER_URL, REFRESH_MS, TIMEOUT_MS, PLACE_COLUMNS, placeColumns, DEFAULT_UNIT }