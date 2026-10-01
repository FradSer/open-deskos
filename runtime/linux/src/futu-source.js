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

function createFutuSource({ runtimeDir = '', services = () => ({}), channelToken = '', stateDir = '', onReject = () => {}, onRefuse = () => {}, now = () => Date.now() } = {}) {
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
      // A connection that closed is not a reading that is merely old: the last
      // measurement is still the last one, but nothing is producing a newer one,
      // and the Shell knows it the moment the socket closes. Reporting it live
      // until the freshness window expires would draw a number that has stopped
      // moving as though it were still being updated.
      if (record.dropped) {
        return { state: 'unavailable', service, error: 'plugin disconnected', updatedAt: record.updatedAt, snapshot: record.snapshot }
      }
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

  async function stopServer(id) {
    const running = servers.get(id)
    if (!running) return
    servers.delete(id)
    await running.server.stop()
  }

  async function refreshServices() {
    const declaredServices = declared()
    for (const [id, def] of Object.entries(declaredServices)) {
      if (!def) continue
      // The endpoint is declared where the plugin also reads it, so the shell must
      // not restate it, and a plugin on another host may use the network form.
      const endpoint = resolveEndpoint(def, runtimeDir)
      const running = servers.get(id)
      // A declaration that moved is followed rather than ignored: the previous
      // listener answers for a service that no longer declares that address, and
      // the address the plugin is now using has nothing listening on it.
      if (running && (running.endpoint !== endpoint || running.revision !== def.revision)) {
        await stopServer(id)
      }
      // Nothing to listen for, or already listening on exactly this declaration.
      if (servers.has(id) || endpoint === null) continue
      const server = createServicePluginSocket({
        endpoint,
        channelToken,
        stateDir,
        services: { [id]: { revision: def.revision } },
        onReject,
        onSnapshot: (record) => latest.set(record.service, { dropped: false, ...record }),
        onStatus: (status) => {
          // Only a dropped connection is recorded here, and only a published
          // record clears it. Reopening the socket is not a reading: a plugin
          // that reconnects and then stalls would otherwise put a snapshot from
          // before the outage back on the desk as live.
          if (status.service && status.state === 'disconnected') {
            const current = latest.get(status.service)
            latest.set(status.service, { ...(current || {}), dropped: true })
          }
        },
      })
      servers.set(id, { server, endpoint, revision: def.revision })
      try {
        await server.start()
      } catch (error) {
        // A bind that failed is not a running listener, so this service is taken
        // back out of the registry: keeping it there is what left the tile
        // reading "syncing" for the life of the process, because every later
        // refresh skips a service it believes is already listening. main.js calls
        // this on a timer precisely so it gets another chance. Only this service
        // is affected; every other declared service still gets its listener,
        // because a package that cannot bind must not take the services beside it
        // down with it.
        servers.delete(id)
        onRefuse(id, error.message)
      }
    }
    // A service whose declaration disappeared stops being listened for: nothing
    // else would ever withdraw its endpoint.
    for (const id of [...servers.keys()]) {
      if (!declaredServices[id]) await stopServer(id)
    }
  }

  async function stop() {
    for (const id of [...servers.keys()]) await stopServer(id)
  }

  return { start, stop, snapshot, refreshServices }
}

module.exports = { createFutuSource, resolveEndpoint, STALE_MS }
