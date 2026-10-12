'use strict'

const { createFutuServiceReadings, getFutuHealth } = require('./readings/futu')
const manifest = require('./manifest.json')

module.exports = { manifest, create(ctx) {
  const config = ctx.capability('desk.futu')
  const catalog = ctx.get('odk:system/package-catalog/v1')
  const definitions = {}
  const source = config.create({ ...config.options, services: () => ({ ...definitions }) })
  ctx.onCleanup(() => source.stop())
  async function refresh() {
    if (ctx.signal.aborted) return
    let next
    try {
      next = {}
      for (const entry of await catalog.list()) {
        if (!entry?.service || !entry.id) continue
        next[entry.service.id] = { revision: entry.revision, endpoint: entry.service.endpoint ?? entry.service.socket, label: entry.name }
      }
    } catch { next = null }
    if (ctx.signal.aborted) return
    const endpoint = config.env.ODK_FUTU_ENDPOINT || config.env.ODESK_FUTU_SOCKET
    const bootstrap = { revision: config.env.ODESK_FUTU_SERVICE_REVISION || 'dev', endpoint }
    if (next) {
      if (endpoint && !next['futu-poller']) next['futu-poller'] = bootstrap
      for (const id of Object.keys(definitions)) if (!(id in next)) delete definitions[id]
      Object.assign(definitions, next)
    } else if (endpoint && !definitions['futu-poller']) definitions['futu-poller'] = bootstrap
    if (ctx.signal.aborted) return
    try { await source.refreshServices() } catch (error) { config.report(`futu services unavailable: ${error.message}`) }
  }
  const ipc = ctx.capability('ipc')
  ipc.handle('odk-futu-holdings', (_event, request) => source.snapshot(request?.service || 'futu-poller'))
  ctx.onCleanup(() => ipc.removeHandler('odk-futu-holdings'))
  return { ports: {
    'odk:service/futu/v1': { source, refresh, services: () => Object.fromEntries(Object.entries(definitions).map(([id, entry]) => [id, entry.label])) },
    'odk:desk-service-readings/futu/v1': { readings: () => createFutuServiceReadings(source, definitions), refresh },
    'odk:plugin-health/odk.service.futu/v1': { snapshot: () => getFutuHealth(source, definitions) },
  } }
} }
