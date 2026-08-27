const BUILTIN_APPS = [
  { appId: 'calendar', name: '日历', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'clock', name: '时钟', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'pomodoro', name: '番茄钟', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'year', name: '年度进度', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'app-manager', name: '应用管理', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
]

const APP_STATES = new Set(['installed', 'running', 'paused', 'stopped'])

function createAppManagerEndpoint({ apps = BUILTIN_APPS } = {}) {
  const states = new Map(apps.map((app) => [app.appId, 'installed']))
  const foreground = { appId: null }

  function get(appId) {
    const app = apps.find((candidate) => candidate.appId === appId)
    if (!app) return null
    return {
      ...app,
      capabilities: [...(app.capabilities || [])],
      state: states.get(appId),
    }
  }

  function result(appId) {
    return { ok: true, app: get(appId) }
  }

  function requireInstalled(appId) {
    const app = get(appId)
    if (!app) return { ok: false, error: 'not-found' }
    if (app.state === 'removed') return { ok: false, error: 'not-installed' }
    return { ok: true, app }
  }

  function start(appId) {
    const available = requireInstalled(appId)
    if (!available.ok) return available
    const { app } = available
    if (app.kind === 'ui' && foreground.appId && foreground.appId !== appId) {
      return { ok: false, error: 'foreground-busy' }
    }
    states.set(appId, 'running')
    if (app.kind === 'ui') foreground.appId = appId
    return result(appId)
  }

  function stop(appId) {
    const available = requireInstalled(appId)
    if (!available.ok) return available
    states.set(appId, 'stopped')
    if (foreground.appId === appId) foreground.appId = null
    return result(appId)
  }

  function pause(appId) {
    const available = requireInstalled(appId)
    if (!available.ok || available.app.state !== 'running') {
      return available.ok ? { ok: false, error: 'invalid-state' } : available
    }
    states.set(appId, 'paused')
    return result(appId)
  }

  function resume(appId) {
    const available = requireInstalled(appId)
    if (!available.ok || available.app.state !== 'paused') {
      return available.ok ? { ok: false, error: 'invalid-state' } : available
    }
    states.set(appId, 'running')
    return result(appId)
  }

  function rollbackOpen(intent) {
    const target = get(intent.appId)
    if (!target) return { ok: false, error: 'not-found' }
    if (!APP_STATES.has(intent.targetState) || target.state === 'removed') {
      return { ok: false, error: 'invalid-state' }
    }
    if (intent.previousAppId) {
      const previous = get(intent.previousAppId)
      if (!previous || previous.state === 'removed') return { ok: false, error: 'not-installed' }
      if (!APP_STATES.has(intent.previousState)) return { ok: false, error: 'invalid-state' }
      states.set(intent.previousAppId, intent.previousState)
    }
    states.set(intent.appId, intent.targetState)
    foreground.appId = intent.previousAppId || null
    return result(intent.appId)
  }

  function rollbackAction(intent) {
    const app = get(intent.appId)
    if (!app || app.state === 'removed' || !APP_STATES.has(intent.previousState)) {
      return { ok: false, error: 'invalid-state' }
    }
    states.set(intent.appId, intent.previousState)
    foreground.appId = intent.previousForegroundAppId || null
    return result(intent.appId)
  }

  function route(intent, action) {
    const trace = []
    const appId = intent?.appId
    const app = get(appId)
    trace.push({ layer: 'installer', action: 'ensure-installed', appId })
    if (!app) return { ok: false, error: 'not-found', trace }

    if (intent.type === 'open-app') {
      trace.push({ layer: 'app-manager', action: 'activate-ui', appId })
      if (app.state === 'removed') return { ok: false, error: 'not-installed', trace }
      const previousAppId = foreground.appId
      const previousState = previousAppId ? states.get(previousAppId) : null
      const previousTargetState = app.state
      if (previousAppId && previousAppId !== appId) {
        states.set(previousAppId, 'stopped')
        foreground.appId = null
      }
      const started = start(appId)
      if (!started.ok) {
        if (previousAppId) {
          states.set(previousAppId, previousState)
          foreground.appId = previousAppId
        }
        return { ...started, trace }
      }
      trace.push({ layer: 'app-runtime', action: 'start', appId })
      return {
        ...started,
        previousAppId,
        previousState,
        previousTargetState,
        trace,
      }
    }

    if (intent.type === 'install-app') {
      trace[0].action = 'install'
      states.set(appId, 'installed')
      return { ...result(appId), trace }
    }

    if (intent.type === 'remove-app') {
      trace[0].action = 'remove'
      if (app.state === 'removed') return { ok: false, error: 'not-installed', trace }
      if (foreground.appId === appId) return { ok: false, error: 'foreground-busy', trace }
      states.set(appId, 'removed')
      return { ...result(appId), trace }
    }

    if (intent.type === 'rollback-open') {
      trace[0].action = 'rollback'
      trace.push({ layer: 'app-manager', action: 'rollback-open', appId })
      const restored = rollbackOpen(intent)
      return { ...restored, trace }
    }

    if (intent.type === 'rollback-action') {
      trace[0].action = 'rollback'
      trace.push({ layer: 'app-manager', action: 'rollback-action', appId })
      const restored = rollbackAction(intent)
      return { ...restored, trace }
    }

    if (intent.type !== 'action') return { ok: false, error: 'unsupported-intent', trace }
    if (app.state === 'removed') return { ok: false, error: 'not-installed', trace }
    trace.push({ layer: 'app-manager', action })
    if (!['start', 'pause', 'resume', 'stop'].includes(action)) {
      return { ok: false, error: 'unsupported-action', trace }
    }
    const previousState = app.state
    const previousForegroundAppId = foreground.appId
    const actionResult = action === 'start' ? start(appId)
      : action === 'pause' ? pause(appId)
        : action === 'resume' ? resume(appId) : stop(appId)
    if (!actionResult.ok) return { ...actionResult, trace }
    trace.push({ layer: 'app-runtime', action, appId })
    return { ...actionResult, previousState, previousForegroundAppId, trace }
  }

  return {
    list() {
      return apps.filter((app) => states.get(app.appId) !== 'removed').map((app) => get(app.appId))
    },
    get,
    install(appId) {
      if (!get(appId)) return { ok: false, error: 'not-found' }
      states.set(appId, 'installed')
      return result(appId)
    },
    remove(appId) {
      const app = get(appId)
      if (!app) return { ok: false, error: 'not-found' }
      if (app.state === 'removed') return { ok: false, error: 'not-installed' }
      if (foreground.appId === appId) return { ok: false, error: 'foreground-busy' }
      states.set(appId, 'removed')
      return result(appId)
    },
    start,
    pause,
    resume,
    stop,
    dispatch(intent) {
      if (!intent || typeof intent !== 'object' || typeof intent.appId !== 'string') {
        return { ok: false, error: 'invalid-intent', trace: [] }
      }
      return route(intent, intent.action)
    },
    foreground() {
      return foreground.appId ? get(foreground.appId) : null
    },
  }
}

module.exports = { BUILTIN_APPS, createAppManagerEndpoint }
