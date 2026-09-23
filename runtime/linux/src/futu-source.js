'use strict'

const path = require('node:path')
const { createServicePluginSocket } = require('./service-plugin-socket')

const STALE_MS = 3 * 60 * 1000

function createFutuSource({ runtimeDir, services = () => ({}), now = () => Date.now() } = {}) {
  if (!runtimeDir) throw Error('runtime-dir-required')
  const latest = new Map()
  const servers = new Map()

  function declared() {
    try { return services() || {} } catch { return {} }
  }

  function snapshot(service) {
    const def = declared()[service]
    if (!def) return { state: 'unconfigured', service }
    const record = latest.get(service)
    if (!record) return { state: 'syncing', service }
    if (record.status === 'auth-required') {
      return { state: 'needs-auth', service, secrets: record.secrets || [], updatedAt: record.updatedAt }
    }
    if (record.status === 'error') {
      return { state: 'unavailable', service, error: record.message || record.code || 'poll failed', updatedAt: record.updatedAt }
    }
    if (record.snapshot) {
      if (now() - (record.updatedAt || 0) > STALE_MS) {
        return { state: 'unavailable', service, error: 'stale snapshot', updatedAt: record.updatedAt, snapshot: record.snapshot }
      }
      return { state: 'live', service, snapshot: record.snapshot, updatedAt: record.updatedAt }
    }
    return { state: 'syncing', service }
  }

  async function start() {
    await refreshServices()
  }

  async function refreshServices() {
    for (const [id, def] of Object.entries(declared())) {
      if (!def || typeof def.socket !== 'string' || servers.has(id)) continue
      // A service that binds its own socket declares the absolute path once, in the shared file the
      // shell also reads, so the shell must not restate it as a name relative to its runtime dir.
      const socket = path.isAbsolute(def.socket) ? def.socket : path.join(runtimeDir, def.socket)
      const server = createServicePluginSocket({
        socketPath: socket,
        services: { [id]: { revision: def.revision } },
        onSnapshot: (record) => latest.set(record.service, record),
        onStatus: (status) => {
          if (status.service && status.state === 'disconnected') {
            const current = latest.get(status.service)
            latest.set(status.service, { ...(current || {}), dropped: true, droppedAt: now() })
          }
        },
      })
      servers.set(id, server)
      await server.start()
    }
  }

  async function stop() {
    for (const server of servers.values()) await server.stop()
    servers.clear()
  }

  return { start, stop, snapshot, refreshServices }
}

module.exports = { createFutuSource, STALE_MS }
