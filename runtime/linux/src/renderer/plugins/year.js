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
      ctx.onTick((now) => {
        const ratio = yearRatio(now)
        fill.style.width = `${(ratio * 100).toFixed(2)}%`
        pct.textContent = `${Math.round(ratio * 100)}%`
        pct.classList.toggle('year-pct-wide', Math.round(ratio * 100) === 100)
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
