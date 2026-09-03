;
(function (root) {
  'use strict'

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  root.odkPlugins.register({
    id: 'odk.tile.almanac',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Calendar',
    state: 'Available',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-header">
          <div class="widget-heading">
            <span class="w-name">Today</span>
            <span class="al-weekday text-odk-red"></span>
          </div>
          <span class="widget-glance-badge">LOCAL</span>
        </div>
        <div class="al-body odk-row items-baseline">
          <span class="al-day"></span>
          <span class="al-month"></span>
        </div>
        <div class="widget-footer">
          <span class="w-state">${this.state}</span>
          <span class="widget-footer-note">Date</span>
        </div>`

      const weekday = el.querySelector('.al-weekday')
      const day = el.querySelector('.al-day')
      const month = el.querySelector('.al-month')
      ctx.onTick((now) => {
        weekday.textContent = WEEKDAYS[now.getDay()]
        day.textContent = now.getDate()
        month.textContent = now.toLocaleString('en-US', { month: 'short' })
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
