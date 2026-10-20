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
    opensApp: 'clock',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="widget-heading">Clock</span>
        <div class="widget-signal clock-body">
          <time class="w-clock-time">--:--</time>
        </div>
        <span class="w-state clock-context">Local time</span>`

      const time = el.querySelector('.w-clock-time')
      ctx.onTick((now) => {
        const reading = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
        if (time.textContent === reading) return
        time.textContent = reading
        time.dateTime = reading
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
