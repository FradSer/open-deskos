;
(function (root) {
  'use strict'

  function usageLabel(snapshot) {
    if (!snapshot) return 'OpenCode Go not synchronized'
    return `OpenCode Go · Rolling ${snapshot.rollingPct ?? '--'}%`
  }

  root.odkPlugins.register({
    id: 'odk.peek.bridge',
    manifest: { schemaVersion: 1 },
    kind: 'peek',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="peek-text odk-stack">
          <span class="peek-primary" id="peek-subscription" role="status" aria-live="polite"></span>
          <span class="peek-secondary" id="peek-network"></span>
          <span class="peek-secondary" id="peek-remote"></span>
          <span class="peek-secondary" id="peek-app"></span>
        </span>
        <svg class="peek-chevron" data-tabler="chevron-right" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 6l6 6l-6 6" /></svg>`

      const subscription = el.querySelector('#peek-subscription')
      const network = el.querySelector('#peek-network')
      const remote = el.querySelector('#peek-remote')
      const app = el.querySelector('#peek-app')
      ctx.trackCleanup?.(ctx.subscription.subscribe((status) => {
        subscription.textContent = status.state === 'available'
          ? usageLabel(status.snapshot)
          : ctx.subscription.label()
        subscription.classList.toggle('text-odk-green', status.state === 'available')
      }))
      ctx.trackCleanup?.(ctx.connection.subscribe(() => {
        network.textContent = ctx.connection.label()
      }))
      ctx.trackCleanup?.(ctx.remoteLink.subscribe((state) => {
        remote.textContent = `Remote · ${ctx.REMOTE_LINK_LABELS[state]}`
      }))
      if (ctx.onPlatformState) ctx.trackCleanup?.(ctx.onPlatformState((active) => {
        app.textContent = active.state === 'idle' ? 'No App open' : `${active.label} · ${active.state === 'running' ? 'Running' : active.state}`
        app.dataset.appId = active.appId || ''
        app.dataset.route = active.route || ''
      }))
    },
    activate(ctx) {
      return ctx.emitIntent({ type: 'open-app', appId: 'system-status', widgetId: 'odk.peek.bridge', route: 'status' })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
