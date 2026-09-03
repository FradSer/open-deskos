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
    appId: null,
    mount(el, ctx) {
      el.innerHTML = `
        <div class="year-head odk-row items-center justify-between w-full">
          <span class="w-name">${this.app}</span>
          <div class="odk-row items-center gap-2">
            <span class="widget-glance-badge">LIVE</span>
            <span class="w-state">${this.state}</span>
          </div>
        </div>
        <div class="year-row odk-row items-center">
          <span class="year-pct">--%</span>
          <div class="meter"><div class="meter-fill"></div></div>
        </div>`

      const fill = el.querySelector('.meter-fill')
      const pct = el.querySelector('.year-pct')
      ctx.onTick((now) => {
        const ratio = yearRatio(now)
        fill.style.width = `${(ratio * 100).toFixed(2)}%`
        pct.textContent = `${Math.round(ratio * 100)}%`
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
