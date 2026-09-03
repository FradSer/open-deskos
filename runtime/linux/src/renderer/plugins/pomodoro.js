;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.pomodoro',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Pomodoro',
    state: 'Not started',
    interaction: 'display-only',
    mount(el) {
      el.innerHTML = `
        <div class="widget-header">
          <div class="widget-heading">
            <span class="w-name">${this.app}</span>
          </div>
          <span class="widget-glance-badge">READ ONLY</span>
        </div>
        <div class="pomodoro-body">
          <div class="pomodoro-ring-wrap">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-track" cx="60" cy="60" r="50"/>
              <circle class="ring-arc" cx="60" cy="60" r="50"/>
            </svg>
            <span class="ring-mmss">--:--</span>
          </div>
        </div>
        <div class="widget-footer">
          <span class="w-state">${this.state}</span>
          <span class="widget-footer-note">App on later page</span>
        </div>`
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
