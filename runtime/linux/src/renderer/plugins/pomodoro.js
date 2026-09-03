;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.pomodoro',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Pomodoro',
    state: 'Not started',
    interaction: 'open-app',
    appId: 'pomodoro',
    lifecycle: {
      install() {},
      enable() {},
      mount(el, ctx) {
        this.renderTile(el)
        this.stateUnsubscribe = ctx.platform?.subscribeAppState?.((appId, state) => {
          if (appId !== this.appId) return
          const label = state === 'Running' ? 'Running' : this.state
          el.dataset.state = label
          const status = el.querySelector('.w-state')
          if (status) status.textContent = label
        }) || null
      },
      start() {},
      pause() {},
      resume() {},
      stop() {},
      unmount(el) {
        this.stateUnsubscribe?.()
        this.stateUnsubscribe = null
        el.replaceChildren()
      },
      disable() {},
      uninstall() {},
    },
    renderTile(el) {
      el.innerHTML = `
        <div class="widget-header odk-row items-center justify-between w-full">
          <span class="w-name">${this.app}</span>
          <span class="widget-action-cue" aria-hidden="true">
            <svg data-tabler="chevron-right" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 6l6 6l-6 6" /></svg>
          </span>
        </div>
        <div class="pomodoro-body odk-row items-center justify-center">
          <div class="pomodoro-ring-wrap">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-track" cx="60" cy="60" r="50"/>
              <circle class="ring-arc" cx="60" cy="60" r="50"/>
            </svg>
            <span class="ring-mmss">--:--</span>
          </div>
        </div>
        <span class="w-state">${this.state}</span>`
    },
    name: 'Pomodoro',
    appKind: 'ui',
    version: 'builtin',
  })
})(typeof window !== 'undefined' ? window : globalThis)
