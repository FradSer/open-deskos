const ENV_STALE_MS = 5 * 60 * 1000 // the main node republishes env readings every minute
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
  let env = null
  const nodes = new Map()

  function node(id) {
    let entry = nodes.get(id)
    if (!entry) {
      entry = { id, online: undefined, pump: undefined, soilPercent: undefined, soilUpdatedAt: 0 }
      nodes.set(id, entry)
    }
    return entry
  }

  function applyEnv(leaf, value, now) {
    const number = parseNumber(value)
    if (number === undefined) return false
    if (!env) env = {}
    env.updatedAt = now
    if (leaf === 'temp') env.tempC = number
    else if (leaf === 'humidity') env.humidity = number
    else if (leaf === 'pressure') env.pressureHpa = number
    else if (leaf === 'lux') env.lux = number
    else return false
    return true
  }

  function applyNodeMessage(rest, value, now) {
    const match = /^node(\d+)\/(soil|pump|online)$/.exec(rest)
    if (!match) return false
    const id = Number.parseInt(match[1], 10)
    if (id < 1 || id > MAX_NODES) return false
    const leaf = match[2]
    if (leaf === 'soil') {
      if (value === 'NC') {
        const entry = node(id)
        entry.soilPercent = null
        entry.soilUpdatedAt = now
        return true
      }
      const number = parseNumber(value)
      if (number === undefined) return false
      const entry = node(id)
      entry.soilPercent = Math.min(100, Math.max(0, number))
      entry.soilUpdatedAt = now
      return true
    }
    const flag = parseBool(value)
    if (flag === undefined) return false
    node(id)[leaf] = flag
    return true
  }

  return {
    markConnected(value) {
      connected = value === true
    },
    applyMessage(topic, payload, now = Date.now()) {
      if (typeof topic !== 'string' || !topic.startsWith(prefix)) return false
      const rest = topic.slice(prefix.length)
      if (rest.startsWith('main/')) return applyEnv(rest.slice(5), payload, now)
      return applyNodeMessage(rest, payload, now)
    },
    snapshot(now = Date.now()) {
      const envStale = !env || now - env.updatedAt > ENV_STALE_MS
      return {
        configured: true,
        connected,
        env: env ? { ...env, stale: envStale } : null,
        nodes: [...nodes.values()]
          .sort((a, b) => a.id - b.id)
          .map((entry) => ({ ...entry })),
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
    client.on('message', (topic, payload) => {
      store.applyMessage(topic, payload.toString(), Date.now())
    })
  } catch (error) {
    console.error(`hydra mqtt source disabled: ${error.message}`)
    return {
      configured: false,
      snapshot: () => ({ configured: false, connected: false, env: null, nodes: [] }),
      stop() {},
    }
  }

  return {
    configured: true,
    snapshot: (now = Date.now()) => store.snapshot(now),
    stop: () => client?.end(true),
  }
}

module.exports = { createHydraStore, createHydraSource, ENV_STALE_MS }
