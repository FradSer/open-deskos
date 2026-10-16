'use strict'

const { createDeviceLocation } = require('../../../src/device-location')
const PLACE_COLUMNS = 20
const WEATHER_STATES = ['live', 'stale', 'unavailable', 'unconfigured']
const codes = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloud'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'cloud'], 48: ['Rime fog', 'cloud'],
  51: ['Light drizzle', 'rain'], 53: ['Moderate drizzle', 'rain'], 55: ['Dense drizzle', 'rain'],
  56: ['Light freezing drizzle', 'rain'], 57: ['Dense freezing drizzle', 'rain'],
  61: ['Slight rain', 'rain'], 63: ['Moderate rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Light freezing rain', 'rain'], 67: ['Heavy freezing rain', 'rain'],
  71: ['Slight snow', 'snow'], 73: ['Moderate snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light rain showers', 'rain'], 81: ['Moderate rain showers', 'rain'], 82: ['Violent rain showers', 'rain'],
  85: ['Light snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'], 96: ['Thunderstorm with hail', 'thunder'], 99: ['Thunderstorm with hail', 'thunder'],
}
function describeWeatherCode(code) {
  const [condition, sky] = codes[code] || ['Unknown', 'cloud']
  return { condition, sky }
}
function placeColumns(value) {
  return [...value].reduce((total, character) => total + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(character) ? 2 : 1), 0)
}
function placeLabel(value) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return placeColumns(text) <= PLACE_COLUMNS ? text : ''
}
function coordinate(value, maximum) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) && Math.abs(parsed) <= maximum ? parsed : null
}
function temperature(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return Math.abs(rounded) <= 100 ? rounded : null
}

function createWeatherSource(options = {}) {
  const { fetchImpl = fetch, now = Date.now, cacheFile, fsImpl = require('node:fs'), pathImpl = require('node:path'),
    refreshMs = 600000, timeoutMs = 8000, providerUrl = 'https://api.open-meteo.com/v1/forecast', onUpdate = () => {} } = options
  const lifetime = new AbortController()
  const abort = () => lifetime.abort()
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const latitude = coordinate(options.latitude !== undefined ? options.latitude : process.env.ODK_WEATHER_LAT, 90)
  const longitude = coordinate(options.longitude !== undefined ? options.longitude : process.env.ODK_WEATHER_LON, 180)
  const configured = latitude !== null && longitude !== null
  const pinned = options.latitude !== undefined || options.longitude !== undefined
  const named = placeLabel(options.place !== undefined ? options.place : process.env.ODK_WEATHER_PLACE)
  const locator = !configured && !pinned && options.locationProvider !== null
    ? options.locationProvider || createDeviceLocation({ fetchImpl, now, signal: lifetime.signal,
      timeoutMs: options.locationTimeoutMs, refreshMs: options.locationRefreshMs, providerUrl: options.locationUrl })
    : null
  let position = configured ? { latitude, longitude, place: named, source: 'configured' } : null
  const label = (target = position) => target.place || `${target.latitude.toFixed(2)}, ${target.longitude.toFixed(2)}`
  const blank = (status, error = null) => ({ status, place: position ? label() : null, unit: '°C', current: null,
    daily: null, updatedAt: null, hint: status === 'unconfigured' ? 'Set ODK_WEATHER_LAT and ODK_WEATHER_LON' : null,
    error, locationSource: position?.source || null })
  let state = blank(configured || locator ? 'unavailable' : 'unconfigured')
  let providerPending = null
  let providerPosition = null
  let lookupNumber = 0
  let latestLookup = null
  let requestsStarted = 0
  const active = new Set()
  if (configured && cacheFile) {
    try {
      const cached = JSON.parse(fsImpl.readFileSync(cacheFile, 'utf8'))
      const reading = cached?.reading
      if (cached?.version === 2 && cached.location?.latitude === latitude && cached.location?.longitude === longitude
        && reading?.current && temperature(reading.current.temperature) !== null) {
        state = { status: 'stale', place: placeLabel(reading.place) || label(), unit: reading.current.unit || '°C',
          current: reading.current, daily: reading.daily || null, updatedAt: Number(reading.updatedAt) || null,
          hint: null, error: null, locationSource: 'configured' }
      }
    } catch { /* The next successful provider response replaces unusable cache. */ }
  }
  const decode = payload => {
    const current = temperature(payload?.current?.temperature_2m)
    const high = Array.isArray(payload?.daily?.temperature_2m_max) ? temperature(payload.daily.temperature_2m_max[0]) : null
    const low = Array.isArray(payload?.daily?.temperature_2m_min) ? temperature(payload.daily.temperature_2m_min[0]) : null
    const code = payload?.current?.weather_code
    if (current === null || high === null || low === null || !Number.isInteger(code)) return null
    const unit = typeof payload?.current_units?.temperature_2m === 'string' ? payload.current_units.temperature_2m.slice(0, 4) : '°C'
    return { current: { temperature: current, unit, code, ...describeWeatherCode(code) }, daily: { high, low } }
  }
  const synchronize = async target => {
    const stamp = now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const url = `${providerUrl}?latitude=${target.latitude}&longitude=${target.longitude}&current=temperature_2m,weather_code`
        + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
      const response = await fetchImpl(url, { signal: AbortSignal.any([controller.signal, lifetime.signal]), headers: { accept: 'application/json' } })
      if (!response?.ok) throw Error(`provider responded ${response?.status ?? 'without a status'}`)
      const type = response.headers?.get?.('content-type') || ''
      if (type && !type.includes('json')) throw Error(`provider responded ${type.split(';')[0]}`)
      const reading = decode(await response.json())
      if (lifetime.signal.aborted || target !== position) return state
      if (!reading) throw Error('provider payload was not a usable reading')
      state = { status: 'live', place: label(target), unit: reading.current.unit || '°C', ...reading,
        updatedAt: stamp, hint: null, error: null, locationSource: target.source }
      if (cacheFile) {
        try {
          fsImpl.mkdirSync(pathImpl.dirname(cacheFile), { recursive: true })
          fsImpl.writeFileSync(cacheFile, JSON.stringify({ version: 2,
            location: { latitude: target.latitude, longitude: target.longitude },
            reading: { place: label(target), ...reading, updatedAt: stamp } }), { mode: 0o600 })
        } catch { /* A cache error does not discard a live reading. */ }
      }
      onUpdate()
    } catch (error) {
      if (!lifetime.signal.aborted && target === position) {
        const message = error?.name === 'AbortError' ? `provider timed out after ${timeoutMs} ms` : error?.message || 'provider unavailable'
        state = state.current ? { ...state, status: 'stale', error: message } : { ...blank('unavailable', message), updatedAt: state.updatedAt }
      }
    } finally { clearTimeout(timer) }
    return state
  }
  const request = () => {
    if (!providerPending) {
      requestsStarted++
      providerPosition = position
      providerPending = synchronize(position).finally(() => { providerPending = null; providerPosition = null })
    }
    return providerPending
  }
  const locate = async () => {
    if (locator) {
      const number = ++lookupNumber
      const found = await locator.resolve()
      if (lifetime.signal.aborted || number !== lookupNumber) return false
      if (found.status === 'located') {
        const next = { latitude: found.latitude, longitude: found.longitude, place: placeLabel(found.place), source: 'device' }
        if (!position || ['latitude', 'longitude', 'place', 'source'].some(key => next[key] !== position[key])) {
          position = next
          if (state.current) state = { ...state, status: 'stale' }
        }
      }
      else if (!position) {
        state = { ...blank('unavailable', `location unavailable: ${found.error || 'no usable answer'}`), updatedAt: state.updatedAt }
        return false
      }
    }
    return true
  }
  const acquire = async ({ force = false } = {}) => {
    if (!configured && !locator) return state
    const previousRequests = requestsStarted
    let joined = false
    if (locator) {
      let lookup = locate()
      latestLookup = lookup
      let located = await lookup
      while (lookup !== latestLookup && !lifetime.signal.aborted) {
        joined = true
        lookup = latestLookup
        located = await lookup
      }
      if (!located) return state
    } else await Promise.resolve()
    if (joined && requestsStarted !== previousRequests) force = false
    if (lifetime.signal.aborted) return state
    while (providerPending) {
      if (providerPosition === position) return providerPending
      await providerPending
      if (lifetime.signal.aborted) return state
    }
    if (!force && state.status === 'live' && state.updatedAt !== null && now() - state.updatedAt < refreshMs) return state
    if (!force && state.current) { void request(); return state }
    return request()
  }
  const refresh = requestOptions => {
    if (lifetime.signal.aborted) return Promise.resolve(state)
    const pending = acquire(requestOptions)
    active.add(pending)
    const release = () => active.delete(pending)
    void pending.then(release, release)
    return pending
  }
  const stop = async () => {
    abort()
    options.signal?.removeEventListener('abort', abort)
    await Promise.allSettled([...active, ...(providerPending ? [providerPending] : [])])
  }
  return { configured, refresh, snapshot: () => state, stop }
}

module.exports = { createWeatherSource, describeWeatherCode, placeColumns, PLACE_COLUMNS, WEATHER_STATES }
