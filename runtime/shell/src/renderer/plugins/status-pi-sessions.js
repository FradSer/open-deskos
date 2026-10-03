;(function (root) {
  'use strict'

  // Inline outline markup, not bare names: core/icons.js swaps a theme variant
  // over whatever the element already holds, so the Instrument original must
  // exist at mount time.
  const SESSION_ICON = '<svg data-tabler="terminal-2" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M8 9l3 3l-3 3" /><path d="M13 15l3 0" /><path d="M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12" /></svg>'
  const WORKSPACE_ICON = '<svg data-tabler="folder" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg>'
  const BRIEFING_ID = 'odk.briefing.pi-sessions'

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`
  }

  function settledPhrase(settled) {
    return settled === 1 ? '1 session has settled' : `${settled} sessions have settled`
  }

  // The State Bar indicator is the shell's only always-mounted Pi Sessions
  // reader, so the Today briefing is published from its refresh instead of
  // scanning the same host a fourth time.
  function briefingParts(summary) {
    if (!summary) return [{ text: 'Pi session status is unavailable.' }]
    const running = summary.running ?? 0
    const settled = summary.settled ?? 0
    if (running === 0) {
      if (settled === 0) return [{ text: 'No Pi sessions are working today.' }]
      return [
        { text: 'No Pi sessions are working today; ' },
        { icon: SESSION_ICON, text: settledPhrase(settled), emphasis: true },
        { text: '.' },
      ]
    }
    return [
      { text: 'You have ' },
      { icon: SESSION_ICON, text: plural(running, 'Pi session'), emphasis: true },
      { text: ' working across ' },
      { icon: WORKSPACE_ICON, text: plural(summary.workspacesCount ?? 0, 'workspace'), emphasis: true },
      { text: ', today.' },
    ]
  }

  root.odkPlugins.register({
    id: 'odk.status.pi-sessions',
    manifest: { schemaVersion: 1 },
    kind: 'status',
    slot: 'left',
    mount(el, ctx) {
      el.innerHTML = `
        <button type="button" class="sb-pi-status flex items-center" id="sb-pi-status" aria-label="Pi sessions">
          <span class="sb-pi-dot"></span>
          <span class="sb-pi-label">PI</span>
          <span class="sb-pi-count" id="sb-pi-count">0</span>
        </button>`

      const btn = el.querySelector('#sb-pi-status')
      const dot = el.querySelector('.sb-pi-dot')
      const count = el.querySelector('#sb-pi-count')

      let tickCount = 0
      let sourceLabel = 'Pi sessions'
      const publishBriefing = (summary) => {
        ctx.briefing.contribute({ id: BRIEFING_ID, order: 20, parts: briefingParts(summary) })
      }
      const unavailable = () => {
        count.textContent = '--'
        dot.className = 'sb-pi-dot'
        btn.classList.remove('has-running')
        btn.setAttribute('aria-label', `${sourceLabel} unavailable`)
        btn.setAttribute('title', `${sourceLabel} unavailable`)
        publishBriefing(null)
      }

      const refresh = async () => {
        if (typeof root.odkPlatform?.getPiSessions !== 'function') {
          unavailable()
          return
        }
        try {
          const res = await root.odkPlatform.getPiSessions()
          sourceLabel = res?.source?.label || 'Pi sessions'
          if (!res || res.ok === false) {
            unavailable()
            return
          }
          btn.setAttribute('title', sourceLabel)
          const running = res?.summary?.running ?? 0
          count.textContent = String(running)
          publishBriefing(res.summary)
          if (running > 0) {
            dot.className = 'sb-pi-dot active'
            btn.classList.add('has-running')
            btn.setAttribute('aria-label', `${sourceLabel} · ${running} active Pi session${running > 1 ? 's' : ''}`)
          } else {
            dot.className = 'sb-pi-dot'
            btn.classList.remove('has-running')
            btn.setAttribute('aria-label', `${sourceLabel} · No active Pi sessions`)
          }
        } catch {
          unavailable()
        }
      }

      btn.addEventListener('click', () => {
        ctx.navigateToPage?.('pi-sessions')
      })

      refresh()

      if (ctx?.onTick) {
        ctx.onTick(() => {
          tickCount += 1
          if (tickCount % 3 === 0) {
            refresh()
          }
        })
      }
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
