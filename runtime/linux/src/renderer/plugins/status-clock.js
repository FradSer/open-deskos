;
(function (root) {
  'use strict'

  function pad2(value) {
    return String(value).padStart(2, '0')
  }

  root.odkPlugins.register({
    id: 'status-clock',
    kind: 'status',
    slot: 'right',
    mount(el, ctx) {
      el.innerHTML = `<span class="sb-time">--:--</span>`
      const time = el.querySelector('.sb-time')
      ctx.onTick((now) => {
        time.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
