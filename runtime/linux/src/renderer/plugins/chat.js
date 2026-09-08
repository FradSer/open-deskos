;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.chat',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Chatbot',
    state: 'Pending integration',
    interaction: 'display-only',
    mount(el) {
      el.innerHTML = `
        <div class="widget-status-layout">
          <span class="widget-status-name">${this.app}</span>
          <svg class="widget-corner-icon" data-tabler="message" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" /></svg>
          <strong class="w-state widget-status-value">Pending</strong>
          <span class="widget-status-detail">Integration not available</span>
        </div>`
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
