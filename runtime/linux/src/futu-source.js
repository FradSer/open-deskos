'use strict'

const path = require('node:path')
const { isNamedPipe, isTcpEndpoint } = require('./local-channel')
const { createServicePluginSocket } = require('./service-plugin-socket')

const STALE_MS = 3 * 60 * 1000

/**
 * Where a declared service actually listens. A plugin declares one endpoint: an
 * absolute socket path, a named pipe, or a network address. A bare name is the
 * historical form and resolves under the shell's own runtime directory.
 */
function resolveEndpoint(def, runtimeDir) {
  const declared = typeof def.endpoint === 'string' && def.endpoint.length > 0 ? def.endpoint : def.socket
  if (typeof declared !== 'string' || declared.length === 0) return null
  if (isTcpEndpoint(declared) || isNamedPipe(declared) || path.isAbsolute(declared)) return declared
  if (!runtimeDir) throw Error('runtime-dir-required')
  return path.join(runtimeDir, declared)
}

function createFutuSource({ runtimeDir = '', services = () => ({}), channelToken = '', stateDir = '', onReject = () => {}, now = () => Date.now() } = {}) {
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
      if (!def || servers.has(id)) continue
      // The endpoint is declared where the plugin also reads it, so the shell must
      // not restate it, and a plugin on another host may use the network form.
      const endpoint = resolveEndpoint(def, runtimeDir)
      if (endpoint === null) continue
      const server = createServicePluginSocket({
        endpoint,
        channelToken,
        stateDir,
        services: { [id]: { revision: def.revision } },
        onReject,
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

module.exports = { createFutuSource, resolveEndpoint, STALE_MS }
