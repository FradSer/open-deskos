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

  root.odkPlugins.register(app('calendar', 'Calendar', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><header class="app-surface-header"><h2 class="app-surface-heading">Calendar</h2></header><time class="runtime-date app-detail"></time><p class="runtime-state app-detail">Calendar events unavailable. Date uses the local clock.</p></div>'
    const date = el.querySelector('.runtime-date')
    ctx.onTick((now) => {
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      if (date.dateTime === day) return
      date.dateTime = day
      date.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    })
  }))
  root.odkPlugins.register(app('clock', 'Clock', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><header class="app-surface-header"><h2 class="app-surface-heading">Clock</h2></header><time class="runtime-value">--:--</time><p class="runtime-state app-detail">Local time</p></div>'
    const value = el.querySelector('.runtime-value')
    ctx.onTick((now) => {
      const reading = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      if (value.textContent === reading) return
      value.textContent = reading
      value.dateTime = reading
    })
  }))
  root.odkPlugins.register(app('pomodoro', 'Pomodoro', (el) => {
    el.innerHTML = '<div class="runtime-app"><header class="app-surface-header"><h2 class="app-surface-heading">Pomodoro</h2></header><p class="runtime-state app-detail">Timer unavailable</p><p class="app-detail">This view does not provide a countdown timer.</p></div>'
  }))
  root.odkPlugins.register(app('year', 'Year progress', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><header class="app-surface-header"><h2 class="app-surface-heading">Year progress</h2></header><p class="runtime-value">--%</p><p class="runtime-state app-detail"></p></div>'
    const value = el.querySelector('.runtime-value')
    const status = el.querySelector('.runtime-state')
    ctx.onTick((now) => {
      const year = now.getFullYear()
      const start = new Date(year, 0, 1)
      const end = new Date(year + 1, 0, 1)
      const reading = `${Math.round((now - start) / (end - start) * 100)}%`
      const detail = `of ${year} elapsed · Local time`
      if (value.textContent !== reading) value.textContent = reading
      if (status.textContent !== detail) status.textContent = detail
    })
  }))
  root.odkPlugins.register(app('app-manager', 'Built-in views', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app app-manager"><header class="app-surface-header"><h2 class="app-surface-heading">Built-in views</h2></header><label class="app-search-label" for="app-search">Search built-in views</label><input id="app-search" class="app-search" type="search" aria-label="Search built-in views" placeholder="Search built-in views" /><p class="app-manager-status runtime-state app-detail" role="status" aria-live="polite"></p><button class="button-pill button-secondary app-manager-retry" type="button" hidden>Reload</button><ul class="app-list"></ul></div>'
    const search = el.querySelector('.app-search')
    const status = el.querySelector('.app-manager-status')
    const retry = el.querySelector('.app-manager-retry')
    const list = el.querySelector('.app-list')
    let items = []
    let loaded = false
    const render = () => {
      if (!loaded) return
      const query = search.value.trim().toLowerCase()
      const entries = items.filter((item) =>
        !query || item.name.toLowerCase().includes(query) || item.appId.toLowerCase().includes(query))
      status.textContent = entries.length ? '' : items.length
        ? 'No matching built-in views. Clear search to see all views.'
        : 'No built-in views available.'
      list.innerHTML = entries.map((item) =>
        `<li><strong>${item.name}</strong><span>${item.kind} · ${item.version} · ${item.source} · ${item.state}</span></li>`).join('')
    }
    const load = async () => {
      loaded = false
      status.textContent = 'Loading built-in views.'
      retry.hidden = true
      try {
        items = await ctx.platform.listApps()
        loaded = true
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
