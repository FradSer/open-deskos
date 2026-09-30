'use strict'

const { createDeskDataRegistry } = require('./desk-data-registry')
const { createDeskDataControl } = require('./desk-data-control')

const CATALOG_ID = 'odk.plugins.installed'
const CATALOG_LIMIT = 20

// The Shell's own vocabulary for a reading. A source's own states map here once,
// so a reading reaches a reader as itself and never as a plausible value. What a
// state falls back to is the table's own decision: a source whose states all mean
// a reading exists reads live, and one with nothing to say defaults to
// unavailable rather than to a number.
const WEATHER_STATES = { unconfigured: ['unconfigured'], unavailable: ['unavailable'], stale: ['stale'], live: ['live'] }
const HYDRA_STATES = {
  unconfigured: snapshot => snapshot?.configured === false,
  unavailable: snapshot => snapshot?.connected !== true,
  stale: snapshot => snapshot?.env?.stale === true,
}
const WEREAD_STATES = { unconfigured: ['unconfigured'], unavailable: ['loading', 'error'] }
const QUOTA_STATES = { unconfigured: ['unconfigured'], live: ['available'] }

function stateFrom(sourceState, table, fallback = 'live') {
  for (const [state, cases] of Object.entries(table)) {
    const matched = typeof cases === 'function' ? cases(sourceState) : cases.includes(sourceState)
    if (matched) return state
  }
  return fallback
}

/*
 * What a reading says to a reader.
 *
 * A projection renames and drops; it never computes, rounds or infers. The tile
 * draws a source's own payload, which also carries the things no spoken answer
 * needs and can be misread as: a cover image, firmware and boot detail, vendor
 * status codes, a machine's working directory. A reading keeps the measurements,
 * gives them plain names, and carries the time each was taken so a stale answer
 * cannot be reported as a live one.
 */
const READING_LIMIT = 20
const TEXT_LIMIT = 400
const GOAL_LIMIT = 160

const isoTime = value => (Number.isFinite(value) ? new Date(value).toISOString() : null)

function text(value, limit = TEXT_LIMIT) {
  if (typeof value !== 'string') return value === undefined ? null : value
  return value.length <= limit ? value : `${value.slice(0, limit)}...`
}

const omit = (value, key) => (value === undefined || value === null ? undefined : value[key])

function pick(source, keys) {
  const result = {}
  for (const [key, read] of Object.entries(keys)) {
    const value = read(source)
    if (value !== undefined) result[key] = value
  }
  return result
}

const projectHydra = snapshot => ({
  asOf: isoTime(snapshot?.updatedAt) ?? undefined,
  gatewayOnline: snapshot?.mainOnline === true,
  greenhouse: snapshot?.env ? pick(snapshot.env, {
    temperatureC: env => env.tempC,
    humidityPercent: env => env.humidity,
    pressureHpa: env => env.pressureHpa,
    lightLux: env => env.lux,
    stale: env => env.stale,
    measuredAt: env => isoTime(env.updatedAt),
  }) : null,
  plants: (Array.isArray(snapshot?.nodes) ? snapshot.nodes : []).map(node => pick(node, {
    id: node => node.id,
    name: node => `Plant ${node.id}`,
    soilPercent: node => node.soilPercent,
    watering: node => node.pump,
    online: node => node.online,
    stale: node => node.stale,
    measuredAt: node => isoTime(node.soilUpdatedAt),
  })),
})

const projectWeather = snapshot => ({
  asOf: isoTime(snapshot?.updatedAt) ?? undefined,
  place: snapshot?.place ?? null,
  temperatureC: omit(snapshot, 'current')?.temperature,
  condition: omit(snapshot, 'current')?.condition,
  highC: omit(snapshot, 'daily')?.high,
  lowC: omit(snapshot, 'daily')?.low,
})

const projectWeread = snapshot => {
  const highlight = snapshot?.highlight
  if (!highlight) return { asOf: isoTime(snapshot?.updatedAt) ?? undefined, book: null, highlight: null }
  return {
    asOf: isoTime(snapshot?.updatedAt) ?? undefined,
    book: { title: highlight.title ?? null, author: highlight.author ?? null },
    // A cover is a picture, not a reading: it is dropped rather than shortened.
    highlight: { text: text(highlight.markText), chapterRange: highlight.range ?? null },
  }
}

/**
 * A ratio the tile draws as a percent.
 *
 * The tile formats a ratio by multiplying it by 100, so a reading publishes that
 * same percent: the spoken answer and the tile cannot differ by a factor of a
 * hundred. This is the one arithmetic a projection does, and it applies only where
 * the display settles the scale. A ratio no display draws and no payload declares
 * is not rescaled and not published under a percent name — it is dropped, because
 * the loss and the value it is a loss against are both published and a guessed
 * scale would be the one number a reader could not trust. A ratio is read the way
 * the tile reads it, with Number(), so a numeric string draws a percentage on the
 * desk and publishes one here rather than dropping a field the desk is showing.
 */
const percent = ratio => {
  if (ratio === null || ratio === undefined || ratio === '') return undefined
  const number = Number(ratio)
  return Number.isNaN(number) ? undefined : Number((number * 100).toFixed(2))
}

const projectPosition = position => pick(position, {
  symbol: position => position.code,
  name: position => position.name,
  quantity: position => position.qty,
  averageCost: position => position.cost,
  price: position => position.price,
  marketValue: position => position.marketVal,
  profitLoss: position => position.plVal,
  currency: position => position.currency,
  dayProfitLoss: position => position.dayPlVal,
  dayChangePercent: position => percent(position.dayRatio),
})

const projectHoldings = snapshot => ({
  asOf: isoTime(snapshot?.updatedAt) ?? undefined,
  positions: (Array.isArray(snapshot?.snapshot?.positions) ? snapshot.snapshot.positions : []).slice(0, READING_LIMIT).map(projectPosition),
  totals: snapshot?.snapshot?.totals ? pick(snapshot.snapshot.totals, {
    marketValue: totals => totals.marketVal,
    profitLoss: totals => totals.plVal,
    cash: totals => totals.cash,
    dayProfitLoss: totals => totals.dayPlVal,
    dayProfitLossByCurrency: totals => totals.dayByCcy,
    // The poller's totals ratio is the day's change over yesterday's base, so it
    // is named as the day it is rather than as an overall profit.
    todayChangePercent: totals => percent(totals.plRatio),
  }) : null,
})

const projectQuota = reading => ({
  asOf: isoTime(reading?.snapshot?.fetchedAt ? Date.parse(reading.snapshot.fetchedAt) : null) ?? undefined,
  accounts: (Array.isArray(reading?.snapshot?.accounts) ? reading.snapshot.accounts : []).map(account => ({
    id: account.id ?? null,
    provider: account.provider ?? null,
    account: account.account ?? null,
    plan: account.plan ?? null,
    groups: (Array.isArray(account.groups) ? account.groups : []).map(group => ({
      title: group.title ?? null,
      windows: (Array.isArray(group.quotas) ? group.quotas : []).map(window => pick(window, {
        label: window => window.label,
        remainingPercent: window => window.remainingPct,
        resetsAt: window => window.resetAt ?? null,
      })),
    })),
  })),
})

const projectSessions = snapshot => {
  const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : []
  return {
    asOf: isoTime(snapshot?.updatedAt) ?? undefined,
    total: sessions.length,
    sessions: sessions.slice(0, READING_LIMIT).map(session => pick(session, {
      id: session => session.sessionId ?? session.id,
      project: session => session.workspaceName,
      workingDirectory: session => session.cwd,
      state: session => session.status,
      goal: session => text(session.latestGoal, GOAL_LIMIT),
      activity: session => text(session.activity, GOAL_LIMIT),
      updatedAt: session => isoTime(session.updatedAt),
    })),
    truncated: sessions.length > READING_LIMIT,
  }
}

const projectCatalog = apps => ({
  total: apps.length,
  apps: apps.slice(0, READING_LIMIT).map(app => pick(app, {
    id: app => app.id,
    name: app => app.name,
    kind: app => app.kind,
    version: app => app.version,
    placement: app => app.placement ?? null,
  })),
  truncated: apps.length > READING_LIMIT,
})

/**
 * What a reading carries when it is not live.
 *
 * An instrument that cannot be read right now has no reading: an empty object
 * beside `unavailable` reads as "there is nothing there", which is a different
 * claim from "nothing could be read". A stale reading is the exception, because
 * its last measurement is the reading and it is marked as the last one.
 */
const measured = (state, value) => (state === 'unavailable' || state === 'unconfigured' ? null : value)

/** A plugin that declares no name is still answerable: its service id names it. */
const serviceLabel = (label, id) => (typeof label === 'string' && label.trim() ? label : id)

/**
 * The Shell's own Desk Data: what the desk holds, one declaration each.
 *
 * Every reading here resolves the source the tile already draws from, so the
 * spoken answer and the screen cannot disagree, and the source keeps its own
 * refresh policy. A package joins the same registry through its manifest
 * declaration, which is the only way an installed Widget or App becomes
 * answerable.
 */
function createShellDeskData({ hydra, weather, weread, futu, piSessions, quota, store, services = () => ({}) } = {}) {
  const registry = createDeskDataRegistry()
  const control = createDeskDataControl(registry)

  /**
   * A Service Plugin publishes what it holds; the Shell never fetches it. The
   * reading is the plugin's own snapshot while it is live, and a Service Plugin
   * that is syncing, waiting for a credential or offline presents no holdings at
   * all rather than the last ones it happened to hold.
   */
  const serviceReading = service => async () => {
    const snapshot = futu?.snapshot?.(service)
    const state = snapshot?.state || 'unavailable'
    return { state, value: state === 'live' ? projectHoldings(snapshot) : null, updatedAt: snapshot?.updatedAt }
  }
  // A Service Plugin is answerable under the id its own package declared, so the
  // reading follows the installed catalog rather than one hardcoded service.
  const declaredServices = () => {
    const declared = services() || {}
    return Object.keys(declared).map(id => [id, declared[id]])
  }
  const syncServiceReadings = () => {
    const declared = new Map(declaredServices())
    for (const entry of registry.list().filter(reading => reading.kind === 'service' && !declared.has(reading.id))) {
      registry.unregister(entry.id)
    }
    for (const [id, label] of declared) {
      registry.register({ id, label: serviceLabel(label, id), kind: 'service', read: serviceReading(id) })
    }
  }
  syncServiceReadings()

  if (hydra?.snapshot) {
    registry.register({
      id: 'odk.tile.hydra',
      label: 'Hydra plants',
      kind: 'tile',
      read: async () => {
        const snapshot = hydra.snapshot()
        const state = stateFrom(snapshot, HYDRA_STATES)
        return { state, value: measured(state, projectHydra(snapshot)), updatedAt: snapshot?.updatedAt }
      },
    })
  }
  if (weather?.refresh) {
    registry.register({
      id: 'odk.tile.weather',
      label: 'Weather',
      kind: 'tile',
      read: async () => {
        const snapshot = await weather.refresh()
        const state = stateFrom(snapshot?.status, WEATHER_STATES, 'unavailable')
        return { state, value: measured(state, projectWeather(snapshot)), updatedAt: snapshot?.updatedAt }
      },
    })
  }
  if (weread?.refresh) {
    registry.register({
      id: 'odk.tile.weread',
      label: 'WeRead highlight',
      kind: 'tile',
      read: async () => {
        const snapshot = await weread.refresh()
        const state = stateFrom(snapshot?.status, WEREAD_STATES)
        return { state, value: measured(state, projectWeread(snapshot)), updatedAt: snapshot?.updatedAt }
      },
    })
  }
  if (piSessions?.scan) {
    registry.register({
      id: 'odk.app.pi-sessions',
      label: 'Pi sessions',
      kind: 'app',
      read: async () => {
        const snapshot = await piSessions.scan()
        if (snapshot?.ok !== true) return { state: 'unavailable', value: null }
        return { state: 'live', value: projectSessions(snapshot), updatedAt: snapshot.updatedAt }
      },
    })
  }
  if (quota?.read) {
    registry.register({
      id: 'odk.page.quota',
      label: 'API quota',
      kind: 'page',
      read: async () => {
        const reading = await quota.read()
        const state = stateFrom(reading?.state, QUOTA_STATES, 'unavailable')
        return { state, value: measured(state, projectQuota(reading)) }
      },
    })
  }
  if (store?.list) {
    registry.register({
      id: CATALOG_ID,
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
      if (!futu?.snapshot) return
      syncServiceReadings()
    },
    /**
     * Rebuild the installed packages' readings from the catalog. Only a package
     * that declared data has a reading, and registering one drops whatever the
     * previous revision of that package published. A catalog that cannot be read
     * leaves every reading as it was: an unreadable catalog is not an empty desk.
     */
    async syncPackages() {
      if (!store?.list) return
      let apps
      try {
        apps = await store.list()
      } catch {
        return
      }
      if (!Array.isArray(apps)) return
      const declared = new Map()
      for (const app of apps) {
        if (app?.id && app.data && Object.keys(app.data.fields || {}).length > 0) declared.set(app.id, app)
      }
      for (const entry of registry.list().filter(reading => reading.kind === 'package' && !declared.has(reading.id))) {
        registry.unregister(entry.id)
      }
      for (const [id, app] of declared) {
        registry.register({ id, label: app.name || id, kind: 'package', declaration: app.data })
      }
    },
  }
}

module.exports = { createShellDeskData, CATALOG_ID }
