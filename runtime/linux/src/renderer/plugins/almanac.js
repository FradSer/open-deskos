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
        <span class="al-weekday"></span>
        <div class="widget-signal al-body">
          <span class="al-day"></span>
          <span class="al-month"></span>
        </div>`

      const weekday = el.querySelector('.al-weekday')
      const day = el.querySelector('.al-day')
      const month = el.querySelector('.al-month')
      ctx.onTick((now) => {
        weekday.textContent = WEEKDAYS[now.getDay()]
        day.textContent = now.getDate()
        day.classList.toggle('al-day-wide', now.getDate() >= 10)
        month.textContent = now.toLocaleString('en-US', { month: 'short' })
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
