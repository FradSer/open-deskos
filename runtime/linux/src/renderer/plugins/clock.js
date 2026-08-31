;
(function (root) {
  'use strict'

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  root.odkPlugins.register({
    id: 'clock',
    kind: 'tile',
    app: 'Clock',
    state: 'Available',
    interaction: 'open-app',
    appId: 'clock',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="w-clock-time">--:--</span>
        <span class="w-state">${this.state}</span>`

      const time = el.querySelector('.w-clock-time')
      ctx.onTick((now) => {
        time.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
