;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'pomodoro',
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
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="50"/>
          <circle class="ring-arc" cx="60" cy="60" r="50"/>
        </svg>
        <span class="ring-mmss">--:--</span>
        <span class="w-name">${this.app}</span>
        <span class="w-state">${this.state}</span>`
    },
    name: 'Pomodoro',
    appKind: 'ui',
    version: 'builtin',
  })
})(typeof window !== 'undefined' ? window : globalThis)
