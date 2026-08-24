;
(function (root) {
  'use strict'

  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  root.odkPlugins.register({
    id: 'clock',
    kind: 'tile',
    app: '时钟',
    state: '待接入',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="w-clock-time">--:--</span>
        <span class="w-state">${this.state}</span>`

      const time = el.querySelector('.w-clock-time')
      ctx.onTick((now) => {
        time.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      })
    },

    // Fullscreen app surface: a real, honest clock instead of the default
    // "not implemented" dialog. mount may return a disposer; the shell runs
    // it when the view closes.
    appView: {
      mount(el, ctx) {
        el.innerHTML = `
          <div class="app-clock">
            <span class="app-clock-time">--:--</span>
            <span class="app-clock-date"></span>
          </div>`
        const time = el.querySelector('.app-clock-time')
        const date = el.querySelector('.app-clock-date')
        const unsub = ctx.onTick((now) => {
          time.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
          date.textContent = `${WEEKDAYS_EN[now.getDay()]} · ${MONTHS_EN[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
        })
        return unsub
      },
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
