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


  // The Pomodoro session is module state: the App owns every control, and a
  // session keeps running and keeps its remaining time while the App is closed.
  // A reading never depends on how many ticks ran, because a running session
  // counts from its own end time.
  const FOCUS_SECONDS = 25 * 60

  const focus = {
    mode: 'idle',
    remaining: FOCUS_SECONDS,
    endAt: null,
    subscribers: new Set(),
    subscribe(callback) {
      this.subscribers.add(callback)
      return () => this.subscribers.delete(callback)
    },
    // One failing view must not stop the others, and a swallowed error would
    // hide a defect, so the failure is reported the way the shared services
    // report theirs.
    notify() {
      const snapshot = this.snapshot()
      for (const callback of [...this.subscribers]) {
        try {
          callback(snapshot)
        } catch (error) {
          console.error('odk focus callback failed:', error)
        }
      }
    },
    remainingNow() {
      if (this.mode !== 'running' || this.endAt === null) return this.remaining
      return Math.max(0, Math.ceil((this.endAt - Date.now()) / 1000))
    },
    // Settling on access keeps every action truthful after the App was closed
    // past the end of a session.
    settle() {
      if (this.mode !== 'running' || this.endAt === null) return
      const remaining = this.remainingNow()
      if (remaining <= 0) {
        this.mode = 'completed'
        this.remaining = 0
        this.endAt = null
        return
      }
      this.remaining = remaining
    },
    tick() {
      this.settle()
      this.notify()
    },
    start() {
      this.settle()
      if (this.mode === 'running') return
      if (this.mode === 'completed' || this.remaining <= 0) this.remaining = FOCUS_SECONDS
      this.mode = 'running'
      this.endAt = Date.now() + this.remaining * 1000
      this.notify()
    },
    pause() {
      this.settle()
      if (this.mode !== 'running') return
      this.mode = 'paused'
      this.endAt = null
      this.notify()
    },
    toggle() {
      this.settle()
      if (this.mode === 'running') this.pause()
      else this.start()
    },
    reset() {
      this.mode = 'idle'
      this.remaining = FOCUS_SECONDS
      this.endAt = null
      this.notify()
    },
    snapshot() {
      const running = this.mode === 'running' && this.endAt !== null
      const remaining = running ? this.remainingNow() : this.remaining
      const mode = running && remaining <= 0 ? 'completed' : this.mode
      const minutes = String(Math.floor(remaining / 60)).padStart(2, '0')
      const seconds = String(remaining % 60).padStart(2, '0')
      const label = mode === 'running' ? 'Focusing'
        : mode === 'paused' ? 'Paused'
          : mode === 'completed' ? 'Completed'
            : 'Focus'
      return { mode, remaining, duration: FOCUS_SECONDS, time: `${minutes}:${seconds}`, state: label }
    },
  }

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
  root.odkPlugins.register(app('pomodoro', 'Pomodoro', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app" data-view="pomodoro"><header class="app-surface-header"><h2 class="app-surface-heading">Pomodoro</h2></header><div class="pomodoro-app-body"><p class="runtime-value pomodoro-dial" id="pomodoro-dial">25:00</p><p class="runtime-state app-detail" id="pomodoro-state">Focus</p><div class="pomodoro-controls"><button class="button-pill button-primary pomodoro-toggle" id="pomodoro-toggle" type="button">Start</button><button class="button-pill button-secondary pomodoro-reset" id="pomodoro-reset" type="button" hidden>Reset</button></div><p class="app-detail">25-minute focus session</p></div></div>'

    const dial = el.querySelector('#pomodoro-dial')
    const state = el.querySelector('#pomodoro-state')
    const toggleBtn = el.querySelector('#pomodoro-toggle')
    const resetBtn = el.querySelector('#pomodoro-reset')

    const render = (snap) => {
      if (dial.textContent !== snap.time) dial.textContent = snap.time
      if (state.textContent !== snap.state) state.textContent = snap.state
      dial.classList.toggle('is-running', snap.mode === 'running')
      // Start, Pause, and Resume are one control that states what it will do
      // next; Reset only exists while a session does.
      const label = snap.mode === 'running' ? 'Pause' : snap.mode === 'paused' ? 'Resume' : 'Start'
      if (toggleBtn.textContent !== label) toggleBtn.textContent = label
      const idle = snap.mode === 'idle'
      if (resetBtn.hidden !== idle) resetBtn.hidden = idle
    }

    const onToggle = () => focus.toggle()
    const onReset = () => focus.reset()

    toggleBtn.addEventListener('click', onToggle)
    resetBtn.addEventListener('click', onReset)

    const unsub = focus.subscribe(render)
    ctx.trackCleanup(() => {
      unsub()
      toggleBtn.removeEventListener('click', onToggle)
      resetBtn.removeEventListener('click', onReset)
    })

    // The shared Tick advances the countdown while the App is open.
    ctx.onTick(() => focus.tick())

    render(focus.snapshot())
  }, [], (intent) => {
    const action = intent.action
    if (action === 'start' || action === 'resume') focus.start()
    else if (action === 'pause') focus.pause()
    else if (action === 'stop') focus.reset()
    else return false
    return true
  }))
  root.odkPlugins.register(app('year', 'Year progress', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app" data-view="year"><header class="app-surface-header"><h2 class="app-surface-heading">Year progress</h2></header><div class="year-reading"><p class="runtime-value">--%</p><progress class="year-meter" max="100" value="0" aria-label="Year elapsed"></progress><p class="runtime-state app-detail"></p></div><dl class="year-calendar"><div><dt>Days completed</dt><dd class="year-days-completed">--</dd></div><div><dt>Days left</dt><dd class="year-days-left">--</dd></div></dl></div>'
    const value = el.querySelector('.runtime-value')
    const status = el.querySelector('.runtime-state')
    ctx.onTick((now) => {
      const year = now.getFullYear()
      const start = new Date(year, 0, 1)
      const end = new Date(year + 1, 0, 1)
      const ratio = (now - start) / (end - start)
      const reading = `${Math.round(ratio * 100)}%`
      el.querySelector('.year-meter').value = ratio * 100
      const today = Date.UTC(year, now.getMonth(), now.getDate())
      const first = Date.UTC(year, 0, 1)
      const completed = (today - first) / 86400000
      const total = (Date.UTC(year + 1, 0, 1) - first) / 86400000
      el.querySelector('.year-days-completed').textContent = String(completed)
      el.querySelector('.year-days-left').textContent = String(total - completed)
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
    let released = false
    ctx.trackCleanup?.(() => { released = true })
    const render = () => {
      if (released || !loaded) return
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
      if (released) return
      loaded = false
      status.textContent = 'Loading built-in views.'
      retry.hidden = true
      try {
        const next = await ctx.platform.listApps()
        if (released) return
        items = next
        loaded = true
        status.textContent = ''
        render()
      } catch (error) {
        if (released) return
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
