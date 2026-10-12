'use strict'

const { createDeskDataRegistry } = require('./desk-data-registry')
const { createDeskDataControl } = require('./desk-data-control')

const CATALOG_ID = 'odk.plugins.installed'

const { createDefaultSourceReadings, createFutuServiceReadings, projectCatalog } = require('./plugins/desk-readings')
const sourceReadingIds = new WeakMap()
const serviceReadingIds = new WeakMap()

/**
 * The Shell's own Desk Data: what the desk holds, one declaration each.
 *
 * Every reading here resolves the source the tile already draws from, so the
 * spoken answer and the screen cannot disagree, and the source keeps its own
 * refresh policy. A package joins the same registry through its manifest
 * declaration, which is the only way an installed Widget or App becomes
 * answerable.
 */
function createShellDeskData({ serviceReadings, readings, hydra, weather, weread, futu, piSessions, quota, store, services = () => ({}), onUpdate = (_id) => {}, registry = createDeskDataRegistry({ onPublish: onUpdate }), signal } = {}) {
  const control = createDeskDataControl(registry)
  let packageSyncGeneration = 0

  const entries = readings ?? createDefaultSourceReadings({ hydra, weather, weread, piSessions, quota })
  if (!Array.isArray(entries)) throw Error('invalid-source-readings')
  const previousIds = sourceReadingIds.get(registry) || new Set()
  const nextIds = new Set()
  const validation = createDeskDataRegistry()
  for (const entry of entries) {
    if (!entry || entry.kind === 'package' || entry.id === CATALOG_ID || nextIds.has(entry.id)
      || (registry.has(entry.id) && !previousIds.has(entry.id))) throw Error('conflicting-source-reading')
    validation.register(entry)
    nextIds.add(entry.id)
  }

  // Named Futu arguments remain a compatibility path for direct callers.
  // Active service plugins provide factories for their own registry declarations.
  const serviceEntries = () => {
    const declared = serviceReadings === undefined ? createFutuServiceReadings(futu, services()) : serviceReadings()
    if (!Array.isArray(declared)) throw Error('invalid-service-readings')
    return declared
  }
  const validateServices = declared => {
    const previousServices = serviceReadingIds.get(registry) || new Set()
    const validation = createDeskDataRegistry()
    const identities = new Set()
    for (const entry of declared) {
      if (!entry || entry.kind !== 'service' || identities.has(entry.id)) throw Error('conflicting-service-reading')
      identities.add(entry.id)
      if (entry.id === CATALOG_ID || nextIds.has(entry.id)
        || (registry.has(entry.id) && !previousServices.has(entry.id))) throw Error('conflicting-service-reading')
      validation.register(entry)
    }
  }
  const syncServiceReadings = (declared = serviceEntries()) => {
    validateServices(declared)
    const next = new Set(declared.map(entry => entry.id))
    for (const id of serviceReadingIds.get(registry) || []) if (!next.has(id)) registry.unregister(id)
    for (const entry of declared) registry.register(entry)
    serviceReadingIds.set(registry, next)
  }
  const initialServices = serviceEntries()
  validateServices(initialServices)
  for (const id of previousIds) registry.unregister(id)
  registry.unregister(CATALOG_ID)
  for (const entry of entries) registry.register(entry)
  sourceReadingIds.set(registry, nextIds)
  syncServiceReadings(initialServices)

  if (store?.list) {
    registry.register({
      id: CATALOG_ID,
      home: { mode: 'hidden', priority: 0, icon: 'apps', fields: [] },
      label: 'Installed Widgets and Apps',
      kind: 'catalog',
      read: async () => {
        let apps
        try {
          apps = await store.list()
        } catch {
          return { state: 'unavailable', value: null }
        }
        if (!Array.isArray(apps)) return { state: 'unavailable', value: null }
        return { state: 'live', value: projectCatalog(apps) }
      },
    })
  }

  return {
    registry,
    control,
    /**
     * Rebuild the Service Plugin readings from the declared services. A service
     * that is no longer declared stops answering, and a new one starts answering
     * under the id its own package declared.
     */
    syncServices() {
      if (serviceReadings === undefined && !futu?.snapshot) return
      syncServiceReadings()
    },
    /**
     * Rebuild the installed packages' readings from the catalog. Only a package
     * that declared data has a reading, and registering one drops whatever the
     * previous revision of that package published. A catalog that cannot be read
     * leaves every reading as it was: an unreadable catalog is not an empty desk.
     */
    async syncPackages({ preserveUnchanged = false } = {}) {
      if (!store?.list || signal?.aborted) return
      const generation = ++packageSyncGeneration
      let apps
      try {
        apps = await store.list()
      } catch {
        return
      }
      if (signal?.aborted || generation !== packageSyncGeneration || !Array.isArray(apps)) return
      const declared = new Map()
      for (const app of apps) {
        if (app?.id && app.data && Object.keys(app.data.fields || {}).length > 0) declared.set(app.id, app)
      }
      const packageEntries = [...declared].map(([id, app]) => ({ id, label: app.name || id, kind: 'package', home: app.home, declaration: app.data, revision: app.revision }))
      const previousEntries = registry.list()
      const validation = createDeskDataRegistry()
      for (const entry of packageEntries) {
        if (previousEntries.some(previous => previous.id === entry.id && previous.kind !== 'package')) throw Error('conflicting-package-reading')
        validation.register(entry)
      }
      for (const entry of previousEntries.filter(reading => reading.kind === 'package' && !declared.has(reading.id))) registry.unregister(entry.id)
      for (const entry of packageEntries) registry.register(entry, { preservePublished: preserveUnchanged })
    },
  }
}

module.exports = { createShellDeskData, CATALOG_ID }
