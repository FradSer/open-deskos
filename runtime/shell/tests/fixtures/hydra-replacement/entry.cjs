'use strict'

// Independent protocol state, projection, health, and connection ownership.
// No Shell implementation modules are imported by this replacement.
function protocol({ topicPrefix = 'hydra', onUpdate = () => {} }) {
  const prefix = `${topicPrefix.split('/')[0]}/`
  const plants = new Map()
  const diagnostics = {}
  let diagnosticsAt = 0
  let connected = false
  let heartbeat
  let heartbeatAt = 0
  let heartbeatLive = false
  let environment = null
  let environmentLive = false
  const numeric = text => Number.isFinite(Number.parseFloat(text)) ? Number.parseFloat(text) : undefined
  const boolean = text => text === 'true' ? true : text === 'false' ? false : undefined
  function accept(topic, payload, time, retained) {
    if (!topic.startsWith(prefix)) return false
    const key = topic.slice(prefix.length)
    if (key === 'main/online') {
      const value = boolean(payload)
      if (value === undefined) return false
      heartbeat = value; heartbeatAt = time; heartbeatLive = !retained
      return true
    }
    if (key === 'main/env') {
      const fields = {}
      for (const item of payload.split(';')) {
        const separator = item.indexOf('=')
        if (separator <= 0) return false
        fields[item.slice(0, separator)] = item.slice(separator + 1)
      }
      if (fields.v === '0') { environment = null; environmentLive = !retained; return true }
      const tempC = numeric(fields.t), humidity = numeric(fields.h), pressureHpa = numeric(fields.p)
      const lux = fields.l === '1' ? numeric(fields.x) : undefined
      const vpdKpa = numeric(fields.d)
      if (fields.v !== '1' || !['0', '1'].includes(fields.l)
        || [tempC, humidity, pressureHpa].includes(undefined)
        || (fields.l === '1' && lux === undefined) || (fields.d !== undefined && vpdKpa === undefined)) return false
      environment = { tempC, humidity, pressureHpa, updatedAt: time,
        ...(lux === undefined ? {} : { lux }), ...(vpdKpa === undefined ? {} : { vpdKpa }) }
      environmentLive = !retained
      return true
    }
    if (key.startsWith('main/diag/')) {
      const leaf = key.slice(10)
      const text = { firmware: 'firmware', build: 'build', boot: 'bootId', reset: 'resetReason' }[leaf]
      if (text) {
        if (!payload.length || payload.length > 63) return false
        diagnostics[text] = payload
      } else if (leaf === 'last_publish_s' && payload === 'never') diagnostics.lastPublishSeconds = null
      else if (['uptime_s', 'last_publish_s'].includes(leaf) && /^\d+$/.test(payload)) {
        diagnostics[leaf === 'uptime_s' ? 'uptimeSeconds' : 'lastPublishSeconds'] = Number.parseInt(payload, 10)
      } else return false
      diagnosticsAt = time
      return true
    }
    const match = /^node(\d+)\/(soil|pump|online|status)$/.exec(key)
    if (!match || +match[1] < 1 || +match[1] > 6) return false
    const id = +match[1], leaf = match[2]
    let value
    if (leaf === 'soil') {
      value = payload === 'NC' ? null : numeric(payload)
      if (value !== null && value !== undefined) value = Math.max(0, Math.min(100, value))
    } else if (leaf === 'status') {
      if (!['IDLE', 'PULSE', 'SOAK', 'WATER', 'PAUSE', 'WAIT', 'DORM', 'FAULT'].includes(payload)) return false
      value = payload
    } else value = boolean(payload)
    if (value === undefined) return false
    const plant = plants.get(id) || { id, online: undefined, pump: undefined, soilPercent: undefined,
      soilUpdatedAt: 0, updatedAt: 0, live: false }
    if (leaf === 'soil') { plant.soilPercent = value; plant.soilUpdatedAt = time }
    else plant[leaf] = value
    plant.updatedAt = time
    if (!retained) plant.live = true
    plants.set(id, plant)
    return true
  }
  return {
    markConnected: value => { connected = value === true },
    applyMessage(topic, payload, time, { retained }) {
      if (accept(topic, payload, time, retained)) onUpdate()
    },
    snapshot(time) {
      const mainOnline = heartbeatLive && heartbeat === true && time - heartbeatAt <= 180000
      const updatedAt = Math.max(environment?.updatedAt || 0, heartbeatAt, ...[...plants.values()].map(plant => plant.updatedAt))
      return { configured: true, connected,
        ...(updatedAt ? { updatedAt } : {}), ...(heartbeat === undefined ? {} : { mainOnline }),
        ...(diagnosticsAt ? { diagnostics: { ...diagnostics, updatedAt: diagnosticsAt } } : {}),
        env: environment ? { ...environment, stale: !environmentLive || time - environment.updatedAt > 300000 } : null,
        nodes: [...plants.values()].sort((a, b) => a.id - b.id).map(({ live, ...plant }) => ({ ...plant,
          pump: plant.status === undefined ? plant.pump : ['PULSE', 'WATER'].includes(plant.status),
          stale: !live || (heartbeat !== undefined && !mainOnline) || time - plant.updatedAt > 180000 })) }
    },
  }
}
const stateOf = value => value.configured === false ? 'unconfigured' : value.connected !== true ? 'unavailable'
  : value.env?.stale === true ? 'stale' : 'live'
const iso = time => Number.isFinite(time) ? new Date(time).toISOString() : null
const present = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
function createHydraReadings(source) {
  return [{ id: 'odk.tile.hydra', label: 'Hydra plants', kind: 'tile',
    home: { mode: 'optional', priority: 50, icon: 'plants', fields: ['greenhouse', 'plants'] },
    async read() {
      const value = source.snapshot(), state = stateOf(value)
      return { state, updatedAt: value.updatedAt, value: ['unconfigured', 'unavailable'].includes(state) ? null : {
        asOf: iso(value.updatedAt) ?? undefined, gatewayOnline: value.mainOnline === true,
        greenhouse: value.env ? present({ temperatureC: value.env.tempC, humidityPercent: value.env.humidity,
          pressureHpa: value.env.pressureHpa, lightLux: value.env.lux, stale: value.env.stale,
          measuredAt: iso(value.env.updatedAt) }) : null,
        plants: value.nodes.map(plant => present({ id: plant.id, name: `Plant ${plant.id}`,
          soilPercent: plant.soilPercent, watering: plant.pump, online: plant.online, stale: plant.stale,
          measuredAt: iso(plant.soilUpdatedAt) })) } }
    } }]
}
function getHydraHealth(source) {
  const value = typeof source.cachedSnapshot === 'function' ? source.cachedSnapshot() : source.snapshot()
  const state = stateOf(value)
  return { state: { live: 'healthy', stale: 'degraded', unavailable: 'failed', unconfigured: 'degraded' }[state],
    ...(state === 'live' ? {} : { reason: state }), ...(Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {}) }
}

function createSource({ url, topicPrefix, connectImpl, onUpdate, now = Date.now }) {
  if (!url) return { configured: false, snapshot: () => ({ configured: false, connected: false, env: null, nodes: [] }), stop() {} }
  const readings = protocol({ topicPrefix, onUpdate })
  let connection
  let lastAttempt = 0
  let stopped = false
  let closing
  function open() {
    if (stopped || connection) return
    const time = now()
    if (time - lastAttempt < 30000) return
    lastAttempt = time
    try {
      connection = connectImpl(url, {
        clientId: `odk-shell-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
        reconnectPeriod: 5000, connectTimeout: 10000,
      })
      connection.on('connect', () => {
        if (stopped) return
        readings.markConnected(true)
        connection.subscribe(`${(topicPrefix || 'hydra').split('/')[0]}/#`)
      })
      for (const event of ['reconnect', 'close']) connection.on(event, () => { if (!stopped) readings.markConnected(false) })
      connection.on('message', (topic, bytes, packet) => {
        if (!stopped) readings.applyMessage(topic, bytes.toString(), now(), { retained: packet?.retain === true })
      })
      connection.on('error', error => { if (!stopped) console.error(`hydra mqtt: ${error.message}`) })
    } catch (error) {
      connection = null
      console.error(`hydra mqtt unavailable, retrying: ${error.message}`)
    }
  }
  open()
  return {
    configured: true,
    cachedSnapshot: (time = now()) => readings.snapshot(time),
    snapshot(time = now()) { open(); return readings.snapshot(time) },
    stop() {
      stopped = true
      if (closing) return closing
      if (!connection) return Promise.resolve()
      const owned = connection
      closing = new Promise((resolve, reject) => {
        try {
          owned.end(true, error => {
            if (error) reject(error)
            else { connection = null; resolve() }
          })
        } catch (error) { reject(error) }
      })
      void closing.catch(() => {})
      return closing
    },
  }
}

exports.create = context => {
  const { options = {}, connect } = context.capability('source.hydra')
  const source = createSource({ ...options, connectImpl: connect || options.connectImpl })
  context.onCleanup(() => source.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-hydra-status', () => source.snapshot())
  context.onCleanup(() => ipc.removeHandler('odk-hydra-status'))
  return { ports: {
    'odk:source/hydra/v1': source,
    'odk:desk-reading/hydra/v1': createHydraReadings(source),
    'odk:plugin-health/odk.source.hydra/v1': { snapshot: () => getHydraHealth(source) },
  } }
}
