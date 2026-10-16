'use strict'

const { isoTime, pick, READING_LIMIT } = require('./common')
const { sourceHealth } = require('../health')

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
  todayChangePercent: percent(snapshot?.snapshot?.totals?.plRatio) ?? null,
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

/** A plugin that declares no name is still answerable: its service id names it. */
const serviceLabel = (label, id) => (typeof label === 'string' && label.trim() ? label : id)


function createFutuServiceReadings(futu, declarations = {}) {
  return Object.entries(declarations || {}).map(([id, label]) => ({
    id, label: serviceLabel(typeof label === 'object' ? label?.label : label, 'Futu holdings'), kind: 'service',
    home: { mode: 'required', priority: 100, icon: 'portfolio', fields: ['todayChangePercent'] },
    read: async () => {
      const snapshot = futu?.snapshot?.(id)
      const state = snapshot?.state || 'unavailable'
      return { state, value: state === 'live' ? projectHoldings(snapshot) : null, updatedAt: snapshot?.updatedAt }
    },
  }))
}

function getFutuHealth(source, declarations = {}) {
  const states = { live: 'healthy', syncing: 'degraded', 'needs-auth': 'degraded', unconfigured: 'degraded', unavailable: 'failed' }
  const components = Object.keys(declarations || {}).map(id => {
    try {
      const provider = typeof source?.snapshot === 'function' ? { snapshot: () => source.snapshot(id) } : source
      return { id, ...sourceHealth(provider, snapshot => snapshot?.state, states) }
    } catch { return { id, state: 'failed', reason: 'probe-failed' } }
  })
  if (!components.length) return { state: 'degraded', reason: 'no-services', components }
  const failures = components.filter(component => component.state === 'failed').length
  if (failures) return { state: failures === components.length ? 'failed' : 'degraded', reason: 'services-unavailable', components }
  if (components.some(component => component.state === 'degraded')) return { state: 'degraded', reason: 'services-nonlive', components }
  if (components.some(component => component.state === 'unknown')) return { state: 'unknown', reason: 'service-state-unknown', components }
  return { state: 'healthy', components }
}

module.exports = { createFutuServiceReadings, getFutuHealth }
