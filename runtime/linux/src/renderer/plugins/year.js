;
(function (root) {
  'use strict'

  function yearRatio(now) {
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    const endOfYear = new Date(now.getFullYear() + 1, 0, 1)
    return (now - startOfYear) / (endOfYear - startOfYear)
  }

  root.odkPlugins.register({
    id: 'odk.tile.year',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Year progress',
    state: 'Live',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-signal year-row">
          <div class="year-signal-line">
            <span class="year-pct">--%</span>
            <span class="year-context">of year elapsed</span>
          </div>
          <div class="meter" aria-hidden="true"><div class="meter-fill"></div></div>
        </div>`

      const fill = el.querySelector('.meter-fill')
      const pct = el.querySelector('.year-pct')
      let renderedWidth = ''
      ctx.onTick((now) => {
        const ratio = yearRatio(now)
        const width = `${(ratio * 100).toFixed(2)}%`
        const reading = `${Math.round(ratio * 100)}%`
        if (renderedWidth !== width) {
          fill.style.width = width
          renderedWidth = width
        }
        if (pct.textContent !== reading) {
          pct.textContent = reading
          pct.classList.toggle('year-pct-wide', Math.round(ratio * 100) === 100)
        }
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
