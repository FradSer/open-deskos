;(function (root) {
  'use strict'
  root.odkRendererDevelopment.define({
    id: 'odk.tile.pi-sessions', manifest: { schemaVersion: 1, version: '2.0.0', minCell: 186 },
    kind: 'tile', app: 'Pi Sessions', state: 'Live', interaction: 'display-only', opensApp: 'pi-sessions',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="pi-widget-body w-full">
          <div class="widget-head"><span class="widget-heading">Pi Sessions</span></div>
          <div class="pi-widget-metric-row">
            <span class="pi-widget-count">--</span>
            <span class="pi-widget-tag-label">Reading</span>
          </div>
          <span class="pi-widget-summary">Waiting for sessions</span>
        </div>`
      const count = el.querySelector('.pi-widget-count'), label = el.querySelector('.pi-widget-tag-label'), summary = el.querySelector('.pi-widget-summary')
      let released = false, requested = 0, applied = 0, ticks = 0
      ctx.trackCleanup?.(() => { released = true })
      const draw = scan => {
        const live = scan && scan.ok !== false
        const sessions = Array.isArray(scan?.sessions) ? scan.sessions : []
        const running = scan?.summary?.running ?? sessions.filter(session => session.status === 'running').length
        count.textContent = live ? String(running) : '--'
        label.textContent = live ? 'Working' : 'Unavailable'
        summary.textContent = live ? `${sessions.filter(session => session.status === 'settled').length} idle` : 'Open Pi Sessions'
        el.classList.toggle('pi-widget-wide-count', live && count.textContent.length > 2)
      }
      const refresh = async () => {
        if (released) return
        const sequence = ++requested
        let scan
        try { scan = await root.odkPlatform?.getPiSessions?.() } catch { scan = null }
        if (released || sequence < applied) return
        applied = sequence
        draw(scan)
      }
      ctx.onTick?.(() => { if (++ticks % 3 === 0) void refresh() })
      void refresh()
    },
  })
})(window)
