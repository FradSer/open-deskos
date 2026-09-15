const ENV_STALE_MS = 5 * 60 * 1000 // the main node republishes env readings every minute
const MAIN_ONLINE_STALE_MS = 3 * 60 * 1000
const NODE_STALE_MS = 3 * 60 * 1000
const MAX_NODES = 6 // FleetRoster::kMaxNodes

function parseBool(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function parseNumber(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function createHydraStore({ topicPrefix = 'hydra' } = {}) {
  const root = topicPrefix.split('/')[0]
  const prefix = `${root}/`
  let connected = false
  let mainOnline
  let mainOnlineUpdatedAt = 0
  let mainOnlineLive = false
  let env = null
  let envLive = false
  const diagnostics = {}
  let diagnosticsUpdatedAt = 0
  const nodes = new Map()

  function node(id) {
    let entry = nodes.get(id)
    if (!entry) {
      entry = { id, online: undefined, pump: undefined, soilPercent: undefined, soilUpdatedAt: 0, updatedAt: 0, live: false }
      nodes.set(id, entry)
    }
    return entry
  }

  function applyEnvSummary(value, now, retained) {
    if (typeof value !== 'string') return false
    const fields = {}
    for (const part of value.split(';')) {
      const separator = part.indexOf('=')
      if (separator <= 0) return false
      fields[part.slice(0, separator)] = part.slice(separator + 1)
    }
    if (fields.v === '0') {
      env = null
      envLive = !retained
      return true
    }
    if (fields.v !== '1') return false
    const temp = parseNumber(fields.t)
    const humidity = parseNumber(fields.h)
    const pressure = parseNumber(fields.p)
    if (temp === undefined || humidity === undefined || pressure === undefined) return false
    const vpd = fields.d === undefined ? undefined : parseNumber(fields.d)
    if (fields.d !== undefined && vpd === undefined) return false
    let lux
    if (fields.l === '1') {
      lux = parseNumber(fields.x)
      if (lux === undefined) return false
    } else if (fields.l !== '0') {
      return false
    }
    if (!env) env = {}
    env.updatedAt = now
    envLive = !retained
    env.tempC = temp
    env.humidity = humidity
    env.pressureHpa = pressure
    if (lux === undefined) delete env.lux
    else env.lux = lux
    if (vpd === undefined) delete env.vpdKpa
    else env.vpdKpa = vpd
    return true
  }

  function applyDiagnostic(leaf, value, now) {
    const textFields = { firmware: 'firmware', build: 'build', boot: 'bootId', reset: 'resetReason' }
    if (textFields[leaf]) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 63) return false
      diagnostics[textFields[leaf]] = value
    } else if (leaf === 'uptime_s' || leaf === 'last_publish_s') {
      if (leaf === 'last_publish_s' && value === 'never') {
        diagnostics.lastPublishSeconds = null
      } else if (!/^\d+$/.test(value)) {
        return false
      } else {
        diagnostics[leaf === 'uptime_s' ? 'uptimeSeconds' : 'lastPublishSeconds'] = Number.parseInt(value, 10)
      }
    } else {
      return false
    }
    diagnosticsUpdatedAt = now
    return true
  }

  function applyMainMessage(leaf, value, now, retained) {
    if (leaf.startsWith('diag/')) return applyDiagnostic(leaf.slice(5), value, now)
    if (leaf === 'env') return applyEnvSummary(value, now, retained)
    if (leaf !== 'online') return false
    const online = parseBool(value)
    if (online === undefined) return false
    mainOnline = online
    mainOnlineUpdatedAt = now
    mainOnlineLive = !retained
    return true
  }

  function applyNodeMessage(rest, value, now, retained) {
    const match = /^node(\d+)\/(soil|pump|online|status)$/.exec(rest)
    if (!match) return false
    const id = Number.parseInt(match[1], 10)
    if (id < 1 || id > MAX_NODES) return false
    const leaf = match[2]
    if (leaf === 'status') {
      if (!['IDLE', 'PULSE', 'SOAK', 'WATER', 'PAUSE', 'WAIT', 'DORM', 'FAULT'].includes(value)) return false
      const entry = node(id)
      entry.status = value
      entry.updatedAt = now
      if (!retained) entry.live = true
      return true
    }
    if (leaf === 'soil') {
      if (value === 'NC') {
        const entry = node(id)
        entry.soilPercent = null
        entry.soilUpdatedAt = now
        entry.updatedAt = now
        if (!retained) entry.live = true
        return true
      }
      const number = parseNumber(value)
      if (number === undefined) return false
      const entry = node(id)
      entry.soilPercent = Math.min(100, Math.max(0, number))
      entry.soilUpdatedAt = now
      entry.updatedAt = now
      if (!retained) entry.live = true
      return true
    }
    const flag = parseBool(value)
    if (flag === undefined) return false
    const entry = node(id)
    entry[leaf] = flag
    entry.updatedAt = now
    if (!retained) entry.live = true
    return true
  }

  return {
    markConnected(value) {
      connected = value === true
    },
    applyMessage(topic, payload, now = Date.now(), { retained = false } = {}) {
      if (typeof topic !== 'string' || !topic.startsWith(prefix)) return false
      const rest = topic.slice(prefix.length)
      if (rest.startsWith('main/')) return applyMainMessage(rest.slice(5), payload, now, retained)
      return applyNodeMessage(rest, payload, now, retained)
    },
    snapshot(now = Date.now()) {
      const envStale = !envLive || !env || now - env.updatedAt > ENV_STALE_MS
      const mainIsOnline = mainOnlineLive && mainOnline === true && now - mainOnlineUpdatedAt <= MAIN_ONLINE_STALE_MS
      const mainIsOffline = mainOnline !== undefined && !mainIsOnline
      const updatedAt = Math.max(env?.updatedAt || 0, mainOnlineUpdatedAt, ...[...nodes.values()].map((entry) => entry.updatedAt))
      return {
        configured: true,
        connected,
        ...(updatedAt === 0 ? {} : { updatedAt }),
        ...(mainOnline === undefined ? {} : { mainOnline: mainIsOnline }),
        ...(diagnosticsUpdatedAt === 0 ? {} : { diagnostics: { ...diagnostics, updatedAt: diagnosticsUpdatedAt } }),
        env: env ? { ...env, stale: envStale } : null,
        nodes: [...nodes.values()]
          .sort((a, b) => a.id - b.id)
          .map(({ live, ...entry }) => ({
            ...entry,
            pump: entry.status === undefined
              ? entry.pump
              : entry.status === 'PULSE' || entry.status === 'WATER',
            stale: !live || mainIsOffline || now - entry.updatedAt > NODE_STALE_MS,
          })),
      }
    },
  }
}

function createHydraSource({ url, topicPrefix } = {}) {
  if (!url) {
    return {
      configured: false,
      snapshot: () => ({ configured: false, connected: false, env: null, nodes: [] }),
      stop() {},
    }
  }

  const store = createHydraStore({ topicPrefix })
  let client = null
  let lastAttempt = 0
  const RETRY_MS = 30000
  function ensureClient() {
    if (client) return
    const now = Date.now()
    if (now - lastAttempt < RETRY_MS) return
    lastAttempt = now
    try {
      const mqtt = require('mqtt')
      client = mqtt.connect(url, {
        clientId: `open-deskos-shell-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      })
      client.on('connect', () => {
        store.markConnected(true)
        client.subscribe(`${(topicPrefix || 'hydra').split('/')[0]}/#`)
      })
      client.on('reconnect', () => store.markConnected(false))
      client.on('close', () => store.markConnected(false))
      client.on('error', (error) => {
        console.error(`hydra mqtt: ${error.message}`)
      })
      client.on('message', (topic, payload, packet) => {
        store.applyMessage(topic, payload.toString(), Date.now(), { retained: packet?.retain === true })
      })
    } catch (error) {
      console.error(`hydra mqtt unavailable, retrying: ${error.message}`)
      client = null
    }
  }
  ensureClient()

  return {
    configured: true,
    snapshot: (now = Date.now()) => {
      ensureClient()
      return store.snapshot(now)
    },
    stop: () => client?.end(true),
  }
}

module.exports = { createHydraStore, createHydraSource, ENV_STALE_MS, MAIN_ONLINE_STALE_MS, NODE_STALE_MS }
