const BUILTIN_APPS = [
  { appId: 'calendar', name: '日历', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'clock', name: '时钟', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'pomodoro', name: '番茄钟', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'year', name: '年度进度', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  { appId: 'app-manager', name: '应用管理', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
]

function createAppManagerEndpoint({ apps = BUILTIN_APPS } = {}) {
  const states = new Map(apps.map((app) => [app.appId, 'installed']))
  const foreground = { appId: null }

  function get(appId) {
    const app = apps.find((candidate) => candidate.appId === appId)
    if (!app) return null
    const state = states.get(appId)
    if (state === 'removed') return { ...app, capabilities: [...app.capabilities], state: 'removed' }
    return { ...app, capabilities: [...app.capabilities], state }
  }

  function result(appId) {
    return { ok: true, app: get(appId) }
  }

  function start(appId) {
    const app = get(appId)
    if (!app) return { ok: false, error: 'not-found' }
    if (app.state === 'removed') return { ok: false, error: 'not-installed' }
    if (app.kind === 'ui' && foreground.appId && foreground.appId !== appId) {
      return { ok: false, error: 'foreground-busy' }
    }
    states.set(appId, 'running')
    if (app.kind === 'ui') foreground.appId = appId
    return result(appId)
  }

  function stop(appId) {
    if (!get(appId)) return { ok: false, error: 'not-found' }
    states.set(appId, 'stopped')
    if (foreground.appId === appId) foreground.appId = null
    return result(appId)
  }

  function pause(appId) {
    if (!get(appId) || states.get(appId) !== 'running') return { ok: false, error: 'invalid-state' }
    states.set(appId, 'paused')
    return result(appId)
  }

  function resume(appId) {
    if (!get(appId) || states.get(appId) !== 'paused') return { ok: false, error: 'invalid-state' }
    states.set(appId, 'running')
    return result(appId)
  }

  function route(intent, action) {
    const trace = []
    const appId = intent?.appId
    const app = get(appId)
    trace.push({ layer: 'installer', action: 'ensure-installed', appId })
    if (!app) return { ok: false, error: 'not-found', trace }
    if (intent.type === 'open-app') {
      trace.push({ layer: 'app-manager', action: 'activate-ui', appId })
      if (foreground.appId && foreground.appId !== appId) {
        states.set(foreground.appId, 'stopped')
        foreground.appId = null
      }
      const started = start(appId)
      if (!started.ok) return { ...started, trace }
      trace.push({ layer: 'app-runtime', action: 'start', appId })
      return { ...started, trace }
    }
    if (intent.type === 'install-app') {
      trace[0].action = 'install'
      states.set(appId, 'installed')
      return { ...result(appId), trace }
    }
    if (intent.type === 'remove-app') {
      trace[0].action = 'remove'
      if (foreground.appId === appId) return { ok: false, error: 'foreground-busy', trace }
      states.set(appId, 'removed')
      return { ...result(appId), trace }
    }
    if (intent.type !== 'action') return { ok: false, error: 'unsupported-intent', trace }
    trace.push({ layer: 'app-manager', action })
    if (!['start', 'pause', 'resume', 'stop'].includes(action)) {
      return { ok: false, error: 'unsupported-action', trace }
    }
    const result = action === 'start' ? start(appId)
      : action === 'pause' ? pause(appId)
        : action === 'resume' ? resume(appId) : stop(appId)
    if (result.ok) trace.push({ layer: 'app-runtime', action, appId })
    return { ...result, trace }
  }

  return {
    list() {
      return apps.map((app) => get(app.appId))
    },
    get,
    install(appId) {
      if (!get(appId)) return { ok: false, error: 'not-found' }
      states.set(appId, 'installed')
      return result(appId)
    },
    remove(appId) {
      if (!get(appId)) return { ok: false, error: 'not-found' }
      if (foreground.appId === appId) return { ok: false, error: 'foreground-busy' }
      states.set(appId, 'removed')
      return result(appId)
    },
    start,
    pause(appId) {
      if (!get(appId) || states.get(appId) !== 'running') return { ok: false, error: 'invalid-state' }
      states.set(appId, 'paused')
      return result(appId)
    },
    resume(appId) {
      if (!get(appId) || states.get(appId) !== 'paused') return { ok: false, error: 'invalid-state' }
      states.set(appId, 'running')
      return result(appId)
    },
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
