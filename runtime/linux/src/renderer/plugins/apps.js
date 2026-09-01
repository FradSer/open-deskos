;
(function (root) {
  'use strict'

  function lifecycleFor(mount) {
    return {
      install() {}, enable() {}, mount, start() {}, pause() {}, resume() {},
      stop() {}, unmount(el) { el.replaceChildren() }, disable() {}, uninstall() {},
    }
  }

  const app = (id, name, mount, capabilities = [], handleAction = null) => ({
    id: `odk.app.${id}`,
    manifest: { schemaVersion: 1 },
    kind: 'app',
    appId: id,
    app: name,
    name,
    appKind: 'ui',
    source: 'builtin',
    capabilities,
    handleAction,
    lifecycle: lifecycleFor(mount),
  })

  root.odkPlugins.register(app('calendar', 'Calendar', (el) => {
    el.innerHTML = '<div class="runtime-app"><h2>Calendar</h2><p>Today\'s date is available.</p><p class="runtime-state">Awaiting local calendar data.</p></div>'
  }))
  root.odkPlugins.register(app('clock', 'Clock', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><h2>Clock</h2><p class="runtime-value">--:--</p><p class="runtime-state">View local time in real time.</p></div>'
    const value = el.querySelector('.runtime-value')
    ctx.onTick((now) => {
      value.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    })
  }))
  root.odkPlugins.register(app('pomodoro', 'Pomodoro', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><h2>Pomodoro</h2><p class="runtime-state">Not started</p><button class="button-pill button-primary" type="button">Start timer</button></div>'
    el.querySelector('button').addEventListener('click', () => ctx.emitIntent({
      type: 'action', appId: 'pomodoro', action: 'start',
    }))
  }, [], (intent, context) => {
    if (intent.action !== 'start') return false
    context.platform.setState('pomodoro', 'Running')
    const status = context.runtimeRoot().querySelector('.runtime-state')
    if (status) status.textContent = 'Running'
    return true
  }))
  root.odkPlugins.register(app('year', 'Year progress', (el) => {
    el.innerHTML = '<div class="runtime-app"><h2>Year progress</h2><p>Year progress updates in the Widget in real time.</p></div>'
  }))
  root.odkPlugins.register(app('system-status', 'System status', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app system-status"><h2>System status</h2><dl class="system-status-list"><div><dt>OpenCode Go</dt><dd id="system-status-subscription"></dd></div><div><dt>Network</dt><dd id="system-status-network"></dd></div><div><dt>Remote Link</dt><dd id="system-status-remote"></dd></div><div><dt>Foreground view</dt><dd id="system-status-app"></dd></div></dl><button class="button-pill button-secondary" type="button">Check status again</button></div>'
    const subscription = el.querySelector('#system-status-subscription')
    const network = el.querySelector('#system-status-network')
    const remote = el.querySelector('#system-status-remote')
    const foreground = el.querySelector('#system-status-app')
    const refresh = () => { subscription.textContent = ctx.subscription.label() }
    ctx.trackCleanup?.(ctx.subscription.subscribe(refresh))
    ctx.trackCleanup?.(ctx.connection.subscribe(() => { network.textContent = ctx.connection.label() }))
    ctx.trackCleanup?.(ctx.remoteLink.subscribe((state) => { remote.textContent = ctx.REMOTE_LINK_LABELS[state] }))
    if (ctx.onPlatformState) ctx.trackCleanup?.(ctx.onPlatformState((active) => {
      foreground.textContent = active.state === 'idle' ? 'No built-in view open' : `${active.label} · ${active.state}`
    }))
    el.querySelector('button').addEventListener('click', () => ctx.subscription.refresh())
  }))
  root.odkPlugins.register(app('app-manager', 'Built-in views', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app app-manager"><h2>Built-in views</h2><input class="app-search" type="search" aria-label="Search built-in views" placeholder="Search built-in views" /><p class="app-manager-status" role="status" aria-live="polite"></p><button class="button-pill button-secondary app-manager-retry" type="button" hidden>Reload</button><ul class="app-list"></ul></div>'
    const search = el.querySelector('.app-search')
    const status = el.querySelector('.app-manager-status')
    const retry = el.querySelector('.app-manager-retry')
    const list = el.querySelector('.app-list')
    let items = []
    const render = () => {
      const query = search.value.trim().toLowerCase()
      const entries = items.filter((item) =>
        !query || item.name.toLowerCase().includes(query) || item.appId.toLowerCase().includes(query))
      list.innerHTML = entries.map((item) =>
        `<li><strong>${item.name}</strong><span>${item.kind} · ${item.version} · ${item.source} · ${item.state}</span></li>`).join('')
    }
    const load = async () => {
      status.textContent = 'Loading built-in views.'
      retry.hidden = true
      try {
        items = await ctx.platform.listApps()
        status.textContent = ''
        render()
      } catch (error) {
        items = []
        list.replaceChildren()
        status.textContent = `Unable to load built-in views: ${error.message || 'Unknown error'}`
        retry.hidden = false
      }
    }
    search.addEventListener('input', render)
    retry.addEventListener('click', load)
    const unsubscribe = ctx.platform.subscribeAppState(() => {
      if (items.length > 0) render()
    })
    ctx.trackCleanup?.(unsubscribe)
    load()
  }))
})(typeof window !== 'undefined' ? window : globalThis)
