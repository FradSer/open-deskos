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

  root.odkPlugins.register({
    id: 'odk.page.quota',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="card quota-card odk-stack">
          <div class="quota-title">OpenCode Go usage</div>
          <div class="quota-state" id="quota-state" role="status" aria-live="polite"></div>
          <div class="quota-metrics" id="quota-metrics"></div>
          <div class="quota-checked" id="quota-checked"></div>
          <div class="quota-actions flex flex-wrap">
            <button class="button-pill button-primary" id="quota-refresh" type="button">Check status again</button>
            <button class="button-pill button-secondary" id="quota-help" type="button">Navigation help</button>
          </div>
        </div>`

      const state = el.querySelector('#quota-state')
      const metrics = el.querySelector('#quota-metrics')
      const checked = el.querySelector('#quota-checked')
      const render = (status = ctx.subscription.status()) => {
        state.textContent = ctx.SUBSCRIPTION_LABELS[status.state] || ctx.SUBSCRIPTION_LABELS.unavailable
        checked.textContent = ctx.subscription.lastCheck()
        const snapshot = status.snapshot
        metrics.textContent = snapshot
          ? `Rolling ${percent(snapshot.rollingPct)} · ${resetLabel(snapshot.rollingResetMin)} · Week ${percent(snapshot.weekPct)} · Month ${percent(snapshot.monthPct)} · Zen ${snapshot.zen ?? '--'}`
          : 'Actual usage has not been retrieved.'
      }
      ctx.trackCleanup?.(ctx.subscription.subscribe(render))
      void ctx.subscription.refresh()
      el.querySelector('#quota-refresh').addEventListener('click', () => ctx.subscription.refresh())
      el.querySelector('#quota-help').addEventListener('click', () => ctx.openNavigationHelp())
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
