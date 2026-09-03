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
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-header">
          <div class="widget-heading">
            <span class="w-name">${this.app}</span>
          </div>
          <span class="widget-glance-badge">LIVE</span>
        </div>
        <div class="clock-body">
          <span class="w-clock-time">--:--</span>
        </div>
        <div class="widget-footer">
          <span class="w-state">${this.state}</span>
          <span class="widget-footer-note">24 hour</span>
        </div>`

      const time = el.querySelector('.w-clock-time')
      ctx.onTick((now) => {
        time.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
