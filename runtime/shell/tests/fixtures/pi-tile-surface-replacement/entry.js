;(function (root) {
  'use strict'
  const compact = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
  function inline(value) {
    const source = compact(value)
    const skill = source.match(/<skill\s+name="([^"]+)"[^>]*>/)
    const format = text => escape(text).replace(/`([^`]+)`/g, '<code class="pi-inline-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*([^*]*|$)/g, '$1<em>$2</em>$3')
    if (!skill) return format(source)
    const end = source.indexOf('</skill>')
    const prompt = end < 0 ? '' : source.slice(end + 8).trim()
    return `<span class="pi-skill-tag"><strong class="pi-skill-bracket">[skill]</strong> <span class="pi-skill-name">${escape(skill[1])}</span></span>${prompt ? ` <span class="pi-skill-prompt">${format(prompt)}</span>` : ''}`
  }
  root.odkRendererDevelopment.define({
    id: 'odk.tile.pi-sessions', manifest: { schemaVersion: 1, version: '2.0.0', minCell: 217 },
    kind: 'tile', app: 'Pi Sessions', state: 'Live', interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="pi-widget-body odk-col items-center justify-center w-full">
          <div class="pi-widget-metric-row odk-row items-baseline justify-center w-full">
            <span class="pi-widget-count">--</span>
            <span class="pi-widget-unit" hidden></span>
          </div>
          <div class="pi-widget-live-tag odk-row items-center gap-1">
            <span class="pi-indicator-dot pi-indicator-idle"></span>
            <span class="pi-widget-tag-label">READING</span>
          </div>
          <div class="pi-widget-context odk-col items-center w-full">
            <div class="w-state"></div>
            <div class="pi-widget-activity" hidden></div>
            <span class="pi-widget-summary">Not scanned yet</span>
          </div>
        </div>`
      const count = el.querySelector('.pi-widget-count'), dot = el.querySelector('.pi-indicator-dot')
      const label = el.querySelector('.pi-widget-tag-label'), summary = el.querySelector('.pi-widget-summary')
      const state = el.querySelector('.w-state'), activity = el.querySelector('.pi-widget-activity')
      let released = false, requested = 0, applied = 0, ticks = 0
      ctx.trackCleanup?.(() => { released = true })
      const clear = () => {
        el.classList.remove('pi-widget-detailed'); el.classList.remove('pi-widget-wide-count')
        activity.hidden = true; activity.textContent = ''
        dot.className = 'pi-indicator-dot pi-indicator-idle'; label.className = 'pi-widget-tag-label'
      }
      const failed = (response, error) => {
        clear(); count.textContent = '--'; state.textContent = 'Unavailable'
        label.textContent = error ? 'ERROR' : 'OFFLINE'
        summary.textContent = error ? 'Retrying automatically' : response?.source?.label
          ? `${response.source.label} · Retrying automatically` : 'Scanner unavailable'
      }
      const paint = response => {
        if (!response || response.ok === false) { failed(response, false); return }
        clear()
        const running = response.summary?.running ?? 0, workspaces = response.summary?.workspacesCount ?? 0
        const live = (Array.isArray(response.sessions) ? response.sessions : []).filter(session => ['running', 'settled'].includes(session.status))
        count.textContent = String(running)
        if (count.textContent.length > 2) el.classList.add('pi-widget-wide-count')
        summary.textContent = `${response.source?.label ? response.source.label + ' · ' : ''}${workspaces} workspace${workspaces === 1 ? '' : 's'} · ${live.length} live`
        if (running > 0) {
          dot.className = 'pi-indicator-dot pi-indicator-running'
          label.textContent = 'Working...'; label.className = 'pi-widget-tag-label text-odk-green'
          const working = response.sessions?.find(session => session.status === 'running')
          if (working && (working.latestGoal || working.activity)) {
            el.classList.add('pi-widget-detailed'); state.innerHTML = inline(working.latestGoal || `${running} working`)
            activity.hidden = false; activity.innerHTML = `<span class="pi-pulse-dot"></span>${inline(working.activity || 'Working...')}`
          } else state.textContent = `${running} working`
        } else {
          label.textContent = 'IDLE'
          let freshest
          for (const session of live) if ((Date.parse(session.updatedAt) || 0) > (Date.parse(freshest?.updatedAt) || 0)) freshest = session
          const goal = compact(freshest?.latestGoal)
          if (goal) { el.classList.add('pi-widget-detailed'); state.innerHTML = inline(goal) }
          else state.textContent = live.length ? `${live.length} idle` : 'Idle'
        }
      }
      const refresh = async () => {
        if (released) return
        const sequence = ++requested
        try {
          const response = await root.odkPlatform?.getPiSessions?.()
          if (released || sequence < applied) return
          applied = sequence; paint(response)
        } catch {
          if (released || sequence < applied) return
          applied = sequence; failed(null, true)
        }
      }
      const fit = () => {
        if (released) return
        const bounds = el.getBoundingClientRect()
        summary.hidden = root.odkGridPlacement?.meetsMinCell ? !root.odkGridPlacement.meetsMinCell(bounds.width, bounds.height, 217) : false
      }
      fit()
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(fit); observer.observe(el)
        ctx.trackCleanup?.(() => observer.disconnect())
      }
      ctx.onTick?.(() => { if (++ticks % 3 === 0) void refresh() })
      void refresh()
    },
  })
})(window)
