'use strict'

const { DATA_PORTS } = require('./data-sources')
const { createFutuServiceReadings, getFutuHealth } = require('./readings/futu')
const { healthPort } = require('./health')

const DESK_PORTS = Object.freeze({
  catalog: 'odk:system/package-catalog/v1',
  futu: 'odk:service/futu/v1',
  futuReadings: 'odk:desk-service-readings/futu/v1',
  futuHealth: healthPort('odk.service.futu'),
  data: 'odk:system/data/v1',
})

function define(id, name, port, requires, permissions, create) {
  return {
    manifest: { schemaVersion: 1, id, name, version: '1.0.0', kind: 'service', host: 'electron-main',
      provides: (Array.isArray(port) ? port : port ? [port] : []).map(interfaceName => ({ interface: interfaceName })), requires, permissions },
    create,
  }
}

function createDeskRuntimePlugins({ readingPorts, serviceReadingPorts = [] } = {}) {
  const servicePorts = [...new Set([DESK_PORTS.futuReadings, ...serviceReadingPorts])]
  // Source replacement does not replace installed-package publications. The
  // registry stays with this composition, and a changed catalog still uses the
  // existing syncPackages contract to invalidate package revision data.
  let registry
  let installedRuntimeStarted = false
  return [
    define('odk.system.package-catalog', 'Installed package catalog', DESK_PORTS.catalog, [], ['desk.catalog'], ctx => {
      const config = ctx.capability('desk.catalog')
      const verifier = config.smokeMode ? null : config.createVerifier?.()
      if (verifier) ctx.onCleanup(() => verifier.close())
      const store = config.create({ ...config.options, ...(verifier ? { verify: bundle => verifier.verify(bundle), waitForVerification: () => verifier.drain() } : {}) })
      return { ports: { [DESK_PORTS.catalog]: store } }
    }),
    define('odk.service.futu', 'Futu service readings', [DESK_PORTS.futu, DESK_PORTS.futuReadings, DESK_PORTS.futuHealth],
      [{ interface: DESK_PORTS.catalog }], ['desk.futu', 'ipc'], ctx => {
        const config = ctx.capability('desk.futu')
        const store = ctx.get(DESK_PORTS.catalog)
        const definitions = {}
        const source = config.create({ ...config.options, services: () => ({ ...definitions }) })
        ctx.onCleanup(() => source.stop())
        const refresh = async () => {
          if (ctx.signal.aborted) return
          let next = null
          try {
            const installed = await store.list()
            next = {}
            for (const entry of installed) {
              if (!entry?.service || !entry?.id) continue
              next[entry.service.id] = { revision: entry.revision, endpoint: entry.service.endpoint ?? entry.service.socket, label: entry.name }
            }
          } catch {}
          if (ctx.signal.aborted) return
          const endpoint = config.env.ODK_FUTU_ENDPOINT || config.env.ODK_FUTU_SOCKET
          const bootstrap = { revision: config.env.ODK_FUTU_SERVICE_REVISION || 'dev', endpoint }
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
          [DESK_PORTS.futu]: { source, refresh, services: () => Object.fromEntries(Object.entries(definitions).map(([id, def]) => [id, def.label])) },
          [DESK_PORTS.futuReadings]: { readings: () => createFutuServiceReadings(source, definitions), refresh },
          [DESK_PORTS.futuHealth]: { snapshot: () => getFutuHealth(source, definitions) },
        } }
      }),
    define('odk.system.data', 'Open DeskOS Data registry', DESK_PORTS.data,
      [{ interface: DESK_PORTS.catalog, optional: true },
        ...servicePorts.map(interfaceName => ({ interface: interfaceName, optional: true })),
        ...(readingPorts === undefined ? ['hydra', 'weather', 'weread', 'piSessions', 'quota'].map(name => DATA_PORTS[name]) : readingPorts).map(interfaceName => ({ interface: interfaceName, optional: true }))],
      ['desk.data'], ctx => {
        const config = ctx.capability('desk.data')
        const store = ctx.get(DESK_PORTS.catalog)
        const scan = readingPorts === undefined ? ctx.get(DATA_PORTS.piSessions) : null
        const data = config.create({
          registry, onUpdate: config.onUpdate, store, signal: ctx.signal,
          ...(readingPorts === undefined ? { hydra: ctx.get(DATA_PORTS.hydra), weather: ctx.get(DATA_PORTS.weather), weread: ctx.get(DATA_PORTS.weread),
            quota: ctx.get(DATA_PORTS.quota) } : { readings: readingPorts.flatMap(port => {
              const entries = ctx.get(port)
              if (entries === null) return []
              if (!Array.isArray(entries)) throw Error(`invalid reading port ${port}`)
              return entries
            }) }),
          piSessions: scan ? { scan } : null,
          serviceReadings: () => servicePorts.flatMap(port => {
            const provider = ctx.get(port)
            if (provider === null) return []
            if (typeof provider.readings !== 'function') throw Error(`invalid service reading port ${port}`)
            const entries = provider.readings()
            if (!Array.isArray(entries)) throw Error(`invalid service reading declarations ${port}`)
            return entries
          }),
        })
        registry = data.registry
        return { ports: { [DESK_PORTS.data]: data }, async start() {
          if (!config.smokeMode) await data.syncPackages({ preserveUnchanged: true })
        } }
      }),
    define('odk.system.service-refresh', 'Service catalog refresh', null,
      [...servicePorts.map(interfaceName => ({ interface: interfaceName, optional: true })), { interface: DESK_PORTS.data }], ['desk.refresh'], ctx => {
        const config = ctx.capability('desk.refresh')
        const data = ctx.get(DESK_PORTS.data)
        let refreshing = null
        let timer = null
        const report = error => {
          try { config.report(`service readings refresh failed: ${error.message}`) } catch { /* Diagnostics cannot interrupt other providers. */ }
        }
        ctx.onCleanup(async () => {
          if (timer) { config.clearInterval(timer); timer = null }
          await refreshing
        })
        const refresh = async () => {
          if (ctx.signal.aborted) return
          for (const port of servicePorts) {
            const provider = ctx.get(port)
            if (provider?.refresh !== undefined) {
              try { await provider.refresh() } catch (error) { report(error) }
            }
            if (ctx.signal.aborted) return
          }
          data.syncServices()
        }
        const requestRefresh = () => {
          if (ctx.signal.aborted) return refreshing
          if (!refreshing) {
            const operation = refresh().catch(report)
            refreshing = operation
            void operation.then(() => { if (refreshing === operation) refreshing = null })
          }
          return refreshing
        }
        return { start() {
          if (config.smokeMode || ctx.signal.aborted) return
          requestRefresh()
          timer = config.setInterval(requestRefresh, 60 * 1000)
          timer.unref?.()
        } }
      }),
    define('odk.system.user-apps', 'Installed Widget and App runtime', null,
      [{ interface: DESK_PORTS.data, optional: true }, { interface: DATA_PORTS.deviceGateway, optional: true }, { interface: DESK_PORTS.catalog }], ['desk.user-apps'], ctx => {
        const config = ctx.capability('desk.user-apps')
        const data = ctx.get(DESK_PORTS.data)
        return { async start() {
          if (ctx.signal.aborted) return
          await config.start({ ...config.options, store: ctx.get(DESK_PORTS.catalog), odkData: data,
            deviceGateway: ctx.get(DATA_PORTS.deviceGateway), onCleanup: ctx.onCleanup,
            isStopping: () => ctx.signal.aborted || config.isStopping() })
          if (ctx.signal.aborted) return
          if (!installedRuntimeStarted && !config.smokeMode) {
            const syncing = Promise.resolve(data?.syncPackages())
            ctx.onCleanup(() => syncing.catch(() => {}))
            void syncing.catch(() => console.error('Initial user application data synchronization failed'))
          }
          installedRuntimeStarted = true
        } }
      }),
    define('odk.transport.data', 'Open DeskOS Data Link', null,
      [{ interface: DESK_PORTS.data }], ['desk.link'], ctx => {
        const config = ctx.capability('desk.link')
        const data = ctx.get(DESK_PORTS.data)
        let server
        let opening
        ctx.onCleanup(async () => {
          await opening
          if (server) {
            await server.close()
            server = null
          }
        })
        return { start() {
          if (config.smokeMode || !config.enabled || ctx.signal.aborted) return
          opening = (async () => {
            try {
              // Cleanup waits for opening, including a listener returned after cancellation.
              server = await config.listen({ ...config.options, control: data.control })
            } catch (error) { config.report(`Open DeskOS Data link unavailable: ${error.message}`) }
          })()
        } }
      }),
  ]
}

module.exports = { createDeskRuntimePlugins, DESK_PORTS }
