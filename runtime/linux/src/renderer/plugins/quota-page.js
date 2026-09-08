;
(function (root) {
  'use strict'

  function percent(value) {
    return value === null || value === undefined ? '--' : `${value}%`
  }

  function resetLabel(minutes) {
    if (minutes === null || minutes === undefined) return 'Rolling window'
    const total = Math.max(0, Math.floor(minutes))
    const hours = Math.floor(total / 60)
    const mins = total % 60
    return hours > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${mins}m`
  }

  function metric(label, value) {
    const className = label === 'Reset' ? 'quota-metric quota-metric-description' : 'quota-metric'
    return `<div class="${className}"><dt>${label}</dt><dd>${value}</dd></div>`
  }

  root.odkPlugins.register({
    id: 'odk.page.quota',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    surface: 'app',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="card quota-card app-surface-card odk-stack">
          <header class="app-surface-header">
            <div class="app-surface-heading">
              <h1 class="quota-title">OpenCode Go usage</h1>
            </div>
          </header>
          <div class="quota-status-group">
            <div class="quota-state" id="quota-state" role="status" aria-live="polite"></div>
            <div class="quota-checked" id="quota-checked"></div>
          </div>
          <div class="quota-actions flex flex-wrap">
            <button class="button-pill button-primary" id="quota-refresh" data-remote-initial-focus type="button">Check status again</button>
            <button class="button-pill button-secondary" id="quota-help" type="button">Navigation help</button>
          </div>
          <dl class="quota-metrics" id="quota-metrics" aria-live="polite"></dl>
        </div>`

      const state = el.querySelector('#quota-state')
      const metrics = el.querySelector('#quota-metrics')
      const checked = el.querySelector('#quota-checked')
      const render = (status = ctx.subscription.status()) => {
        state.textContent = ctx.SUBSCRIPTION_LABELS[status.state] || ctx.SUBSCRIPTION_LABELS.unavailable
        checked.textContent = ctx.subscription.lastCheck()
        const snapshot = status.snapshot
        metrics.innerHTML = snapshot
          ? [
              metric('Rolling', percent(snapshot.rollingPct)),
              metric('Reset', resetLabel(snapshot.rollingResetMin)),
              metric('Week', percent(snapshot.weekPct)),
              metric('Month', percent(snapshot.monthPct)),
              metric('Zen', snapshot.zen ?? '--'),
            ].join('')
          : '<div class="quota-metric quota-metric-empty"><dt>Usage</dt><dd>Actual usage has not been retrieved.</dd></div>'
      }
      ctx.trackCleanup?.(ctx.subscription.subscribe(render))
      const refreshButton = el.querySelector('#quota-refresh')
      const refresh = async () => {
        if (refreshButton.disabled) return
        refreshButton.disabled = true
        refreshButton.setAttribute('aria-busy', 'true')
        try {
          await ctx.subscription.refresh()
        } finally {
          refreshButton.disabled = false
          refreshButton.removeAttribute('aria-busy')
        }
      }
      void refresh()
      refreshButton.addEventListener('click', refresh)
      el.querySelector('#quota-help').addEventListener('click', () => ctx.openNavigationHelp())
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
