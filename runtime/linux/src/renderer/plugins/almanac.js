;
(function (root) {
  'use strict'

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  root.odkPlugins.register({
    id: 'odk.tile.almanac',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Calendar',
    state: 'Available',
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
        month.textContent = now.toLocaleString('en-US', { month: 'short' })
      })
    },
    name: 'Calendar',
    appKind: 'ui',
    version: 'builtin',
  })
})(typeof window !== 'undefined' ? window : globalThis)
