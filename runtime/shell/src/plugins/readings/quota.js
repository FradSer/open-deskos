'use strict'

const { stateFrom, isoTime, pick, measured } = require('./common')

const QUOTA_STATES = { unconfigured: ['unconfigured'], live: ['available'] }

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

function createQuotaReadings(quota) {
  if (!quota?.read) return []
  return [{
    id: 'odk.page.quota',
    home: { mode: 'optional', priority: 40, icon: 'quota', fields: ['accounts'] },
    label: 'API quota',
    kind: 'page',
    read: async () => {
      const reading = await quota.read()
      const state = stateFrom(reading?.state, QUOTA_STATES, 'unavailable')
      return { state, value: measured(state, projectQuota(reading)) }
    },
  }]
}

module.exports = { createQuotaReadings }
