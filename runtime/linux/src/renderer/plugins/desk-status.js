;(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.desk-status',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Desk status',
    state: 'Ready',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-header odk-row items-center justify-between w-full">
          <span class="w-name">${this.app}</span>
          <span class="widget-glance-badge">LOCAL</span>
        </div>
        <div class="desk-status-body odk-col items-center justify-center">
          <svg data-tabler="device-desktop" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <rect x="3" y="4" width="18" height="12" rx="1" />
            <path d="M7 20h10" />
            <path d="M9 16v4" />
            <path d="M15 16v4" />
          </svg>
          <strong class="desk-status-value">READY</strong>
          <span class="desk-status-resolution">-- × --</span>
        </div>
        <span class="w-state">Local shell active</span>`

      const resolution = el.querySelector('.desk-status-resolution')
      const refresh = () => {
        resolution.textContent = `${window.innerWidth} × ${window.innerHeight}`
      }
      refresh()
      ctx.onTick(refresh)
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
