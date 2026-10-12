;(function (root) {
  'use strict'

  // Markup and artwork retain the Shell contract; this entry owns projection.
  const icons = {"session": "<svg data-tabler=\"terminal-2\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12\" /></svg>", "workspace": "<svg data-tabler=\"folder\" aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2\" /></svg>"}
  function statement(summary) {
    if (!summary) return [{ text: 'Pi session status is unavailable.' }]
    const working = summary.running ?? 0, idle = summary.settled ?? 0
    if (working === 0) return idle === 0 ? [{ text: 'No Pi sessions are working today.' }] : [
      { text: 'No Pi sessions are working today; ' },
      { icon: icons.session, text: idle === 1 ? '1 session has settled' : `${idle} sessions have settled`, emphasis: true },
      { text: '.' },
    ]
    const workspaces = summary.workspacesCount ?? 0
    return [{ text: 'You have ' },
      { icon: icons.session, text: `${working} Pi session${working === 1 ? '' : 's'}`, emphasis: true },
      { text: ' working across ' },
      { icon: icons.workspace, text: `${workspaces} workspace${workspaces === 1 ? '' : 's'}`, emphasis: true },
      { text: ', today.' }]
  }
  root.odkRendererDevelopment.define({
    id: 'odk.status.pi-sessions', manifest: { schemaVersion: 1, version: '2.0.0' }, kind: 'status', slot: 'left',
    mount(element, context) {
      element.innerHTML = `
        <button type="button" class="sb-pi-status flex items-center" id="sb-pi-status" aria-label="Pi sessions">
          <span class="sb-pi-dot"></span>
          <span class="sb-pi-label">PI</span>
          <span class="sb-pi-count" id="sb-pi-count">0</span>
        </button>`
      const button = element.querySelector('#sb-pi-status')
      const dot = element.querySelector('.sb-pi-dot')
      const count = element.querySelector('#sb-pi-count')
      let released = false, ticks = 0, label = 'Pi sessions'
      const active = () => !released && !context.signal?.aborted
      function render(response, updateLabel = true) {
        if (!active()) return
        const available = response && response.ok !== false
        if (updateLabel) label = response?.source?.label || 'Pi sessions'
        const working = available ? response.summary?.running ?? 0 : null
        count.textContent = available ? String(working) : '--'
        dot.className = `sb-pi-dot${working > 0 ? ' active' : ''}`
        if (working > 0) button.classList.add('has-running')
        else button.classList.remove('has-running')
        button.setAttribute('title', available ? label : `${label} unavailable`)
        button.setAttribute('aria-label', !available ? `${label} unavailable` : working > 0
          ? `${label} · ${working} active Pi session${working > 1 ? 's' : ''}` : `${label} · No active Pi sessions`)
        context.briefing.contribute({ id: 'odk.briefing.pi-sessions', order: 20, parts: statement(available ? response.summary : null) })
      }
      async function refresh() {
        if (!active()) return
        if (typeof root.odkPlatform?.getPiSessions !== 'function') { render(null, false); return }
        try { render(await root.odkPlatform.getPiSessions()) } catch { render(null, false) }
      }
      const navigate = () => { if (active()) context.navigateToPage?.('pi-sessions') }
      button.addEventListener('click', navigate)
      context.trackCleanup?.(() => { released = true; button.removeEventListener('click', navigate) })
      void refresh()
      context.onTick?.(() => { if (++ticks % 3 === 0) void refresh() })
    },
  })
})(window)
