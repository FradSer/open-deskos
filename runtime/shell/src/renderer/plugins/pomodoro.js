;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.pomodoro',
    // Reads at the smallest cell the desk promises, so a span above one cell
    // is only refused below that.
    manifest: { schemaVersion: 1, minCell: 186 },
    kind: 'tile',
    app: 'Pomodoro',
    state: 'App timer',
    interaction: 'display-only',
    opensApp: 'pomodoro',
    mount(el, ctx = {}) {
      el.innerHTML = `
        <div class="widget-head pomodoro-head"><span class="widget-heading">Pomodoro</span><span class="pomodoro-state w-state">${this.state}</span></div>
        <div class="pomodoro-body widget-signal">
          <div class="pomodoro-ring-wrap">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-track" cx="60" cy="60" r="50"/>
              <circle class="ring-arc" cx="60" cy="60" r="50"/>
            </svg>
            <span class="ring-mmss">--:--</span>
            <span class="pomodoro-context">Focus</span>
          </div>
        </div>`
      if (!ctx.onTick || !ctx.trackCleanup) return
      const time = el.querySelector('.ring-mmss')
      const state = el.querySelector('.pomodoro-state')
      const arc = el.querySelector('.ring-arc')
      let released = false, selected = null, unsubscribe = null
      ctx.trackCleanup(() => { released = true; unsubscribe?.(); unsubscribe = null })
      const render = snapshot => {
        if (released) return
        const label = snapshot.mode === 'idle' ? 'Ready' : snapshot.state
        if (time.textContent !== snapshot.time) time.textContent = snapshot.time
        if (state.textContent !== label) state.textContent = label
        arc.style.strokeDashoffset = String(314 * Math.max(0, Math.min(1, snapshot.remaining / snapshot.duration)))
      }
      const refresh = () => {
        if (released) return
        const current = ctx.focus
        if (current !== selected) {
          unsubscribe?.()
          unsubscribe = null
          selected = current
          if (current) unsubscribe = current.subscribe(snapshot => { if (ctx.focus === current) render(snapshot) })
        }
        if (current) render(current.snapshot())
        else { time.textContent = '--:--'; state.textContent = 'App timer'; arc.style.strokeDashoffset = '314' }
      }
      ctx.onTick(refresh)
      refresh()
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
