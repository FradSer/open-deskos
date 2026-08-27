;
(function (root) {
  'use strict'

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  root.odkPlugins.register({
    id: 'almanac',
    kind: 'tile',
    app: '日历',
    state: '可查看',
    interaction: 'open-app',
    appId: 'calendar',
    lifecycle: {
      install() {}, enable() {}, mount(el, ctx) { this.renderTile(el, ctx) }, start() {},
      pause() {}, resume() {}, stop() {}, unmount(el) { el.replaceChildren() },
      disable() {}, uninstall() {},
    },
    renderTile(el, ctx) {
      el.innerHTML = `
        <span class="al-weekday text-odk-red"></span>
        <span class="al-day"></span>
        <span class="al-month"></span>
        <span class="w-state">${this.state}</span>`

      const weekday = el.querySelector('.al-weekday')
      const day = el.querySelector('.al-day')
      const month = el.querySelector('.al-month')
      ctx.onTick((now) => {
        weekday.textContent = WEEKDAYS[now.getDay()]
        day.textContent = now.getDate()
        month.textContent = `${now.getMonth() + 1} 月`
      })
    },
    name: '日历',
    appKind: 'ui',
    version: 'builtin',
  })
})(typeof window !== 'undefined' ? window : globalThis)
