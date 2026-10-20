;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.almanac', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'tile', app: 'Calendar', state: 'Available', interaction: 'display-only', opensApp: 'calendar',
    mount(element, context) {
      // Static markup and Shell styles are shared; date formatting is independent.
      element.innerHTML = `
        <div class="widget-head"><span class="widget-heading">Calendar</span><span class="al-weekday"></span></div>
        <div class="widget-signal al-body">
          <span class="al-day"></span>
          <span class="al-month"></span>
        </div>`
      const weekday = element.querySelector('.al-weekday')
      const day = element.querySelector('.al-day')
      const month = element.querySelector('.al-month')
      const weekFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
      const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' })
      let previous
      context.onTick(date => {
        const identity = [date.getFullYear(), date.getMonth(), date.getDate()].join('/')
        if (identity === previous) return
        previous = identity
        weekday.textContent = weekFormat.format(date)
        day.textContent = String(date.getDate())
        day.classList.toggle('al-day-wide', date.getDate() > 9)
        day.classList.toggle('al-day-narrow', date.getDate() === 1)
        month.textContent = monthFormat.format(date)
      })
    },
  })
})(window)
