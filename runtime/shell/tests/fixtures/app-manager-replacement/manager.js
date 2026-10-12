'use strict'

const catalog = require('./catalog.json')
const lifecycle = { start: 'running', pause: 'paused', resume: 'running', stop: 'stopped' }
const restorable = ['installed', 'running', 'paused', 'stopped']

function createAppManagerEndpoint({ apps = catalog } = {}) {
  const state = new Map(apps.map(app => [app.appId, 'installed']))
  let foregroundId = null
  const fail = error => ({ ok: false, error })
  const get = appId => {
    const metadata = apps.find(app => app.appId === appId)
    return metadata ? { ...metadata, capabilities: [...(metadata.capabilities || [])], state: state.get(appId) } : null
  }
  const success = appId => ({ ok: true, app: get(appId) })
  const available = appId => {
    const app = get(appId)
    return !app ? 'not-found' : app.state === 'removed' ? 'not-installed' : null
  }
  const change = (appId, action) => {
    const error = available(appId)
    if (error) return fail(error)
    const app = get(appId)
    if (action === 'start' && app.kind === 'ui' && foregroundId && foregroundId !== appId) return fail('foreground-busy')
    if ((action === 'pause' && app.state !== 'running') || (action === 'resume' && app.state !== 'paused')) return fail('invalid-state')
    state.set(appId, lifecycle[action])
    if (action === 'start' && app.kind === 'ui') foregroundId = appId
    if (action === 'stop' && foregroundId === appId) foregroundId = null
    return success(appId)
  }
  const install = appId => {
    if (!get(appId)) return fail('not-found')
    state.set(appId, 'installed')
    return success(appId)
  }
  const remove = appId => {
    const error = available(appId)
    if (error) return fail(error)
    if (foregroundId === appId) return fail('foreground-busy')
    state.set(appId, 'removed')
    return success(appId)
  }
  const rollback = request => {
    const app = get(request.appId)
    if (!app || app.state === 'removed') return fail('not-installed')
    if (request.type === 'rollback-open') {
      if (request.expectedTargetState && request.expectedTargetState !== app.state) return fail('stale-transition')
      if (!restorable.includes(request.targetState)) return fail('invalid-state')
      if (request.previousAppId) {
        const previous = get(request.previousAppId)
        if (!previous || previous.state === 'removed') return fail('not-installed')
        if (!restorable.includes(request.previousState)) return fail('invalid-state')
        state.set(request.previousAppId, request.previousState)
      }
      state.set(request.appId, request.targetState)
      foregroundId = request.previousAppId || null
    } else {
      if (request.expectedState && request.expectedState !== app.state) return fail('stale-transition')
      if (!restorable.includes(request.previousState)) return fail('invalid-state')
      if (request.previousForegroundAppId && !get(request.previousForegroundAppId)) return fail('not-found')
      state.set(request.appId, request.previousState)
      foregroundId = request.previousForegroundAppId || null
    }
    return success(request.appId)
  }
  const dispatch = request => {
    if (!request || typeof request !== 'object' || typeof request.appId !== 'string') return { ...fail('invalid-intent'), trace: [] }
    const appId = request.appId
    const trace = [{ layer: 'installer', action: 'ensure-installed', appId }]
    const finish = result => ({ ...result, trace })
    const app = get(appId)
    if (!app) return finish(fail('not-found'))
    if (request.type === 'install-app' || request.type === 'remove-app') {
      trace[0].action = request.type === 'install-app' ? 'install' : 'remove'
      return finish(request.type === 'install-app' ? install(appId) : remove(appId))
    }
    if (request.type === 'rollback-open' || request.type === 'rollback-action') {
      trace[0].action = 'rollback'
      trace.push({ layer: 'app-manager', action: request.type, appId })
      return finish(rollback(request))
    }
    if (request.type === 'open-app') {
      trace.push({ layer: 'app-manager', action: 'activate-ui', appId })
      if (app.state === 'removed') return finish(fail('not-installed'))
      const previousAppId = foregroundId
      const previousState = previousAppId ? state.get(previousAppId) : null
      const targetState = app.state
      if (previousAppId && previousAppId !== appId) {
        state.set(previousAppId, 'stopped')
        foregroundId = null
      }
      const result = change(appId, 'start')
      if (!result.ok) {
        if (previousAppId) { state.set(previousAppId, previousState); foregroundId = previousAppId }
        return finish(result)
      }
      trace.push({ layer: 'app-runtime', action: 'start', appId })
      return finish({ ...result, transition: { previousAppId, previousState, targetState } })
    }
    if (request.type !== 'action') return finish(fail('unsupported-intent'))
    if (app.state === 'removed') return finish(fail('not-installed'))
    const action = request.action
    trace.push({ layer: 'app-manager', action })
    if (typeof action !== 'string' || !Object.hasOwn(lifecycle, action)) return finish(fail('unsupported-action'))
    const previousState = app.state
    const previousForegroundAppId = foregroundId
    const result = change(appId, action)
    if (!result.ok) return finish(result)
    trace.push({ layer: 'app-runtime', action, appId })
    return finish({ ...result, transition: { previousState, previousForegroundAppId, nextState: result.app.state } })
  }
  const captureState = () => ({ version: 1, states: apps.map(app => ({ appId: app.appId, state: state.get(app.appId) })), foregroundAppId: foregroundId })
  const restoreState = snapshot => {
    const entries = snapshot?.states
    if (snapshot?.version !== 1 || !Array.isArray(entries) || entries.length !== apps.length) throw Error('invalid App Manager state')
    const next = new Map()
    for (const entry of entries) {
      if (!entry || !apps.find(app => app.appId === entry.appId) || next.has(entry.appId)
        || ![...restorable, 'removed'].includes(entry.state)) throw Error('invalid App Manager state')
      next.set(entry.appId, entry.state)
    }
    if (snapshot.foregroundAppId !== null && !next.has(snapshot.foregroundAppId)) throw Error('invalid App Manager state')
    for (const [appId, value] of next) state.set(appId, value)
    foregroundId = snapshot.foregroundAppId
  }
  return { get, install, remove, dispatch, captureState, restoreState,
    list: () => apps.filter(app => state.get(app.appId) !== 'removed').map(app => get(app.appId)),
    foreground: () => foregroundId ? get(foregroundId) : null,
    start: appId => change(appId, 'start'), stop: appId => change(appId, 'stop'),
    pause: appId => change(appId, 'pause'), resume: appId => change(appId, 'resume') }
}

module.exports = { createAppManagerEndpoint }
