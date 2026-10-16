'use strict'

// The fixture uses only declared capabilities and standard JavaScript globals.
// It implements the source lifecycle and reading projection independently.
function quotaSource(read, parentSignal) {
  if (typeof read !== 'function') throw TypeError('Quota source requires a read operation')
  const controller = new AbortController()
  let active = 0
  const drains = []
  const cancel = () => controller.abort()
  const unavailable = () => ({ state: 'unavailable', reason: 'Quota source stopped' })
  if (parentSignal.aborted) cancel()
  else parentSignal.addEventListener('abort', cancel, { once: true })
  return {
    async read() {
      if (controller.signal.aborted) return unavailable()
      active++
      try {
        // A shutdown in the calling turn must prevent a new provider request.
        await Promise.resolve()
        if (controller.signal.aborted) return unavailable()
        const result = await read({ signal: controller.signal })
        return controller.signal.aborted ? unavailable() : result
      } catch (error) {
        if (controller.signal.aborted) return unavailable()
        throw error
      } finally {
        active--
        if (active === 0) for (const resolve of drains.splice(0)) resolve()
      }
    },
    stop() {
      cancel()
      parentSignal.removeEventListener('abort', cancel)
      return active === 0 ? Promise.resolve() : new Promise(resolve => drains.push(resolve))
    },
  }
}

function quotaProjection(result) {
  const snapshot = result?.snapshot
  const time = snapshot?.fetchedAt ? Date.parse(snapshot.fetchedAt) : NaN
  return {
    asOf: Number.isFinite(time) ? new Date(time).toISOString() : undefined,
    accounts: (Array.isArray(snapshot?.accounts) ? snapshot.accounts : []).map(account => ({
      id: account.id ?? null, provider: account.provider ?? null,
      account: account.account ?? null, plan: account.plan ?? null,
      groups: (Array.isArray(account.groups) ? account.groups : []).map(group => ({
        title: group.title ?? null,
        windows: (Array.isArray(group.quotas) ? group.quotas : []).map(window => ({
          ...(window.label === undefined ? {} : { label: window.label }),
          ...(window.remainingPct === undefined ? {} : { remainingPercent: window.remainingPct }),
          resetsAt: window.resetAt ?? null,
        })),
      })),
    })),
  }
}

exports.create = context => {
  const { read } = context.capability('source.quota')
  const source = quotaSource(read, context.signal)
  context.onCleanup(() => source.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-opencode-go-status', () => source.read())
  context.onCleanup(() => ipc.removeHandler('odk-opencode-go-status'))
  return { ports: {
    'odk:source/quota/v1': source,
    'odk:desk-reading/quota/v1': [{
      id: 'odk.page.quota', label: 'API quota', kind: 'page',
      home: { mode: 'optional', priority: 40, icon: 'quota', fields: ['accounts'] },
      async read() {
        const result = await source.read()
        const state = result?.state === 'available' ? 'live'
          : result?.state === 'unconfigured' ? 'unconfigured' : 'unavailable'
        const value = quotaProjection(result)
        return { state, value: state === 'live' ? value : null }
      },
    }],
  } }
}
