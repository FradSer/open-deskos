;(function (root) {
  'use strict'
  const titles = { calendar: 'Calendar', clock: 'Clock', pomodoro: 'Pomodoro', year: 'Year progress', 'app-manager': 'Built-in views' }
  const text = (node, value) => { if (node.textContent !== value) node.textContent = value }
  // This fixture owns a separate session. It uses only the public App context.
  const duration = 25 * 60
  const session = { mode: 'idle', remaining: duration, endAt: null }
  const views = new Set()
  function settle() {
    if (session.mode !== 'running') return
    session.remaining = Math.max(0, Math.ceil((session.endAt - Date.now()) / 1000))
    if (session.remaining === 0) { session.mode = 'completed'; session.endAt = null }
  }
  function update() {
    settle()
    for (const render of views) render()
  }
  function action(intent) {
    const name = intent.action
    if (!['start', 'resume', 'pause', 'stop'].includes(name)) return false
    settle()
    if (name === 'stop') Object.assign(session, { mode: 'idle', remaining: duration, endAt: null })
    else if (name === 'pause') {
      if (session.mode === 'running') { session.mode = 'paused'; session.endAt = null }
    } else if (session.mode !== 'running') {
      if (session.mode === 'completed') session.remaining = duration
      session.mode = 'running'
      session.endAt = Date.now() + session.remaining * 1000
    }
    update()
    return true
  }
  function mount(id, el, ctx) {
    const doc = el.ownerDocument
    const make = (tag, className, content) => {
      const node = doc.createElement(tag); node.className = className
      if (content !== undefined) node.textContent = content
      return node
    }
    const body = make('div', id === 'app-manager' ? 'runtime-app app-manager' : 'runtime-app')
    const header = make('header', 'app-surface-header')
    header.append(make('h2', 'app-surface-heading', titles[id])); body.append(header); el.append(body)
    if (id === 'pomodoro') {
      body.dataset.view = 'pomodoro'
      const appBody = make('div', 'pomodoro-app-body')
      const dial = make('p', 'runtime-value pomodoro-dial', '25:00'); dial.id = 'pomodoro-dial'
      const state = make('p', 'runtime-state app-detail', 'Focus'); state.id = 'pomodoro-state'
      const controls = make('div', 'pomodoro-controls')
      const toggle = make('button', 'button-pill button-primary pomodoro-toggle', 'Start')
      toggle.id = 'pomodoro-toggle'; toggle.type = 'button'
      const reset = make('button', 'button-pill button-secondary pomodoro-reset', 'Reset')
      reset.id = 'pomodoro-reset'; reset.type = 'button'; reset.hidden = true
      controls.append(toggle, reset)
      appBody.append(dial, state, controls, make('p', 'app-detail', '25-minute focus session'))
      body.append(appBody)
      const render = () => {
        const minutes = String(Math.floor(session.remaining / 60)).padStart(2, '0')
        const seconds = String(session.remaining % 60).padStart(2, '0')
        text(dial, `${minutes}:${seconds}`)
        text(state, session.mode === 'running' ? 'Focusing' : session.mode === 'paused' ? 'Paused' : session.mode === 'completed' ? 'Completed' : 'Focus')
        text(toggle, session.mode === 'running' ? 'Pause' : session.mode === 'paused' ? 'Resume' : 'Start')
        reset.hidden = session.mode === 'idle'
        dial.classList.toggle('is-running', session.mode === 'running')
      }
      const onToggle = () => {
        settle()
        action({ action: session.mode === 'running' ? 'pause' : 'start' })
      }
      const onReset = () => action({ action: 'stop' })
      toggle.addEventListener('click', onToggle)
      reset.addEventListener('click', onReset)
      views.add(render)
      ctx.trackCleanup(() => {
        views.delete(render)
        toggle.removeEventListener('click', onToggle)
        reset.removeEventListener('click', onReset)
      })
      ctx.onTick(update)
      update()
      return
    }
    if (id === 'app-manager') {
      const label = make('label', 'app-search-label', 'Search built-in views'); label.htmlFor = 'app-search'
      const input = make('input', 'app-search'); input.id = 'app-search'; input.type = 'search'
      input.setAttribute('aria-label', 'Search built-in views'); input.placeholder = 'Search built-in views'
      const status = make('p', 'app-manager-status runtime-state app-detail')
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
      const retry = make('button', 'button-pill button-secondary app-manager-retry', 'Reload'); retry.type = 'button'; retry.hidden = true
      const list = make('ul', 'app-list'); body.append(label, input, status, retry, list)
      let rows = [], ready = false, released = false
      ctx.trackCleanup(() => { released = true })
      const render = () => {
        if (released || !ready) return
        const query = input.value.trim().toLowerCase()
        const visible = rows.filter(row => [row.name, row.appId].some(value => value.toLowerCase().includes(query)))
        text(status, visible.length ? '' : rows.length ? 'No matching built-in views. Clear search to see all views.' : 'No built-in views available.')
        list.replaceChildren(...visible.map(row => {
          const li = doc.createElement('li')
          const name = doc.createElement('strong'); name.textContent = row.name
          const detail = doc.createElement('span'); detail.textContent = [row.kind, row.version, row.source, row.state].join(' · ')
          li.append(name, detail); return li
        }))
      }
      const load = async () => {
        if (released) return
        ready = false; text(status, 'Loading built-in views.'); retry.hidden = true
        try { const result = await ctx.platform.listApps(); if (released) return; rows = result; ready = true; render() }
        catch (error) { if (released) return; rows = []; list.replaceChildren(); text(status, `Unable to load built-in views: ${error.message || 'Unknown error'}`); retry.hidden = false }
      }
      input.addEventListener('input', render); retry.addEventListener('click', load)
      ctx.trackCleanup(ctx.platform.subscribeAppState(() => { if (rows.length) render() }))
      void load(); return
    }
    const value = make(id === 'year' ? 'p' : 'time', id === 'calendar' ? 'runtime-date app-detail' : 'runtime-value')
    const status = make('p', 'runtime-state app-detail', id === 'calendar' ? 'Calendar events unavailable. Date uses the local clock.' : id === 'clock' ? 'Local time' : '')
    let meter, completed, remaining
    if (id === 'year') {
      body.dataset.view = 'year'
      const reading = make('div', 'year-reading')
      meter = make('progress', 'year-meter'); meter.max = 100; meter.value = 0; meter.setAttribute('aria-label', 'Year elapsed')
      reading.append(value, meter, status)
      const calendar = make('dl', 'year-calendar')
      completed = make('dd', 'year-days-completed', '--'); remaining = make('dd', 'year-days-left', '--')
      for (const [label, counter] of [['Days completed', completed], ['Days left', remaining]]) {
        const row = doc.createElement('div'); row.append(doc.createElement('dt'), counter); row.firstChild.textContent = label; calendar.append(row)
      }
      body.append(reading, calendar)
    } else body.append(value, status)
    ctx.onTick(now => {
      if (id === 'clock') {
        const reading = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
        if (value.textContent === reading) return
        text(value, reading); value.dateTime = reading
      } else if (id === 'calendar') {
        const key = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
        if (value.dateTime === key) return
        value.dateTime = key
        text(value, new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now))
      } else {
        const year = now.getFullYear(), boundaries = [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime()]
        text(value, Math.round(100 * (now.getTime() - boundaries[0]) / (boundaries[1] - boundaries[0])) + '%')
        text(status, `of ${year} elapsed · Local time`)
        meter.value = 100 * (now.getTime() - boundaries[0]) / (boundaries[1] - boundaries[0])
        const firstDay = Date.UTC(year, 0, 1)
        const elapsedDays = (Date.UTC(year, now.getMonth(), now.getDate()) - firstDay) / 86400000
        text(completed, String(elapsedDays))
        text(remaining, String((Date.UTC(year + 1, 0, 1) - firstDay) / 86400000 - elapsedDays))
      }
    })
  }
  root.odkBuiltinViewReplacements = Object.entries(titles).map(([appId, title]) => ({
    id: `odk.app.${appId}`, manifest: { schemaVersion: 1, version: '2.0.0' }, kind: 'app',
    appId, app: title, name: title, appKind: 'ui', source: 'builtin', capabilities: [], handleAction: appId === 'pomodoro' ? action : null,
    mount(el, ctx) { mount(appId, el, ctx) }, unmount(el) { el.replaceChildren() },
  }))
})(window)
