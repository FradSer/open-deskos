;(function (root) {
  'use strict'

  root.odkRendererDevelopment.define({
    id: 'odk.tile.year', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'tile', app: 'Year progress', state: 'Live', interaction: 'display-only', opensApp: 'year',
    mount(element, context) {
      // Static markup and Shell styles are shared; elapsed-time projection is independent.
      element.innerHTML = `
        <div class="widget-signal year-row">
          <div class="year-signal-line">
            <span class="year-pct">--%</span>
            <span class="year-context">of year elapsed</span>
          </div>
          <div class="meter" aria-hidden="true"><div class="meter-fill"></div></div>
        </div>`
      const meter = element.querySelector('.meter-fill')
      const label = element.querySelector('.year-pct')
      let previousWidth
      context.onTick(date => {
        const year = date.getFullYear()
        const boundaries = [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime()]
        const percentage = 100 * ((date.getTime() - boundaries[0]) / (boundaries[1] - boundaries[0]))
        const width = `${percentage.toFixed(2)}%`
        if (width !== previousWidth) { meter.style.width = width; previousWidth = width }
        const rounded = Math.round(percentage)
        const value = `${rounded}%`
        if (label.textContent === value) return
        label.textContent = value
        label.classList.toggle('year-pct-wide', rounded === 100)
      })
    },
  })
})(window)
