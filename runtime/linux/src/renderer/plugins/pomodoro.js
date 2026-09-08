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
        <span class="pomodoro-state w-state">${this.state}</span>
        <div class="pomodoro-body widget-signal">
          <div class="pomodoro-ring-wrap">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-track" cx="60" cy="60" r="50"/>
              <circle class="ring-arc" cx="60" cy="60" r="50"/>
            </svg>
            <span class="ring-mmss">--:--</span>
            <span class="pomodoro-context">Focus</span>
          </div>
        </div>`
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
