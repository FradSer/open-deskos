;
(function (root) {
  'use strict'

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  root.odkPlugins.register({
    id: 'odk.tile.clock',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Clock',
    state: 'Available',
    interaction: 'open-app',
    appId: 'clock',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-header odk-row items-center justify-between w-full">
          <span class="w-name">${this.app}</span>
          <span class="widget-action-cue" aria-hidden="true">
            <svg data-tabler="chevron-right" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 6l6 6l-6 6" /></svg>
          </span>
        </div>
        <div class="clock-body odk-row items-baseline justify-center">
          <span class="w-clock-time">--:--</span>
        </div>
        <span class="w-state">${this.state}</span>`

      const time = el.querySelector('.w-clock-time')
      ctx.onTick((now) => {
        time.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
