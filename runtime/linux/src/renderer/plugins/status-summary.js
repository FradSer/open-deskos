;(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.status.summary',
    manifest: { schemaVersion: 1 },
    kind: 'status',
    slot: 'left',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="sb-state-summary" id="sb-state-summary" aria-label="Desk status">
          <span class="sb-state-item" id="sb-network-state"></span>
          <span class="sb-state-divider" aria-hidden="true">·</span>
          <span class="sb-state-item" id="sb-subscription-state"></span>
          <span class="sb-state-divider" aria-hidden="true">·</span>
          <span class="sb-state-item" id="sb-remote-state"></span>
        </div>`

      const network = el.querySelector('#sb-network-state')
      const subscription = el.querySelector('#sb-subscription-state')
      const remote = el.querySelector('#sb-remote-state')
      ctx.trackCleanup?.(ctx.connection.subscribe((online) => {
        network.textContent = online ? ctx.NETWORK_LABELS.connected : ctx.NETWORK_LABELS.disconnected
      }))
      ctx.trackCleanup?.(ctx.subscription.subscribe(() => {
        subscription.textContent = ctx.subscription.label()
      }))
      ctx.trackCleanup?.(ctx.remoteLink.subscribe((state) => {
        remote.textContent = `Remote · ${ctx.REMOTE_LINK_LABELS[state]}`
      }))
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
