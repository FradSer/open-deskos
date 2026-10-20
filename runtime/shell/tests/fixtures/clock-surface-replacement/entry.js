;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.clock', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'tile', app: 'Clock', state: 'Available', interaction: 'display-only', opensApp: 'clock',
    mount(element, context) {
      // Static markup and Shell styles are shared; formatting and Tick ownership are independent.
      element.innerHTML = `
        <span class="widget-heading">Clock</span>
        <div class="widget-signal clock-body">
          <time class="w-clock-time">--:--</time>
        </div>
        <span class="w-state clock-context">Local time</span>`
      const display = element.querySelector('.w-clock-time')
      context.onTick(date => {
        const parts = [date.getHours(), date.getMinutes()]
        const value = parts.map(part => part < 10 ? `0${part}` : `${part}`).join(':')
        if (display.textContent !== value) {
          display.textContent = value
          display.dateTime = value
        }
      })
    },
  })
})(window)
