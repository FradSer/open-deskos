'use strict'

/**
 * A display-only Shell Host has no local Hydra controller. The resident agent
 * projects the reference host's current reading through its authenticated
 * producer channel. This adapter validates that projection before it can reach
 * a Widget; it never invents a measurement.
 */
const HYDRA_PROJECTION_ID = 'odk.service.hydra'
const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const stamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000 ? value : undefined

function normalizeEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env) || typeof env.stale !== 'boolean') return null
  for (const [key, min, max] of [['tempC', -50, 100], ['humidity', 0, 100], ['pressureHpa', 800, 1200], ['lux', 0, 1000000]]) {
    if (env[key] !== undefined && !bounded(env[key], min, max)) return null
  }
  return { ...env, updatedAt: stamp(env.updatedAt) }
}

function normalizeNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length > 8) return null
  const result = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !Number.isInteger(node.id) || node.id < 1 || node.id > 8
      || typeof node.online !== 'boolean' || typeof node.stale !== 'boolean' || typeof node.soilStale !== 'boolean'
      || typeof node.pump !== 'boolean' || node.soilPercent !== undefined && !bounded(node.soilPercent, 0, 100)) return null
    result.push({ ...node, soilUpdatedAt: stamp(node.soilUpdatedAt) })
  }
  return result
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.configured !== true
    || snapshot.connected !== true || typeof snapshot.mainOnline !== 'boolean') return null
  const env = snapshot.env === null || snapshot.env === undefined ? null : normalizeEnv(snapshot.env)
  const nodes = normalizeNodes(snapshot.nodes)
  if ((snapshot.env != null && !env) || !nodes || !env && !nodes.length) return null
  return { configured: true, connected: true, mainOnline: snapshot.mainOnline, env, nodes,
    updatedAt: stamp(snapshot.updatedAt) ?? 0, projection: true }
}

async function readCentralHydraSnapshot(port) {
  if (!port || typeof port.refresh !== 'function' || typeof port.readings !== 'function') return null
  try { await port.refresh() } catch { return null }
  const entry = port.readings().find(reading => reading.id === HYDRA_PROJECTION_ID)
  if (!entry || typeof entry.read !== 'function') return null
  try {
    const reading = await entry.read()
    if (!reading || reading.id !== HYDRA_PROJECTION_ID || reading.state !== 'live' || !reading.value || typeof reading.value !== 'object') return null
    return normalizeSnapshot(reading.value.snapshot)
  } catch { return null }
}

module.exports = { HYDRA_PROJECTION_ID, readCentralHydraSnapshot }
