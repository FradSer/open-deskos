;
(function (root) {
  'use strict'

  function yearRatio(now) {
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    const endOfYear = new Date(now.getFullYear() + 1, 0, 1)
    return (now - startOfYear) / (endOfYear - startOfYear)
  }

  root.odkPlugins.register({
    id: 'year',
    kind: 'tile',
    app: '年度进度',
    state: '实时',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="meter"><div class="meter-fill"></div></div>
        <span class="w-name">${this.app}</span>
        <span class="w-state">${this.state}</span>`

      const fill = el.querySelector('.meter-fill')
      ctx.onTick((now) => {
        fill.style.width = `${(yearRatio(now) * 100).toFixed(2)}%`
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
