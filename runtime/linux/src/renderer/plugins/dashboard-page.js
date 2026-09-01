;
(function (root) {
  'use strict'

  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']

  root.odkPlugins.register({
    id: 'odk.page.dashboard',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="dash">
          <header class="dash-head">
            <div class="dash-wd" id="dash-wd"></div>
            <span class="dash-status-dot" aria-label="Status active"></span>
            <div class="dash-date text-right">
              <span id="dash-md"></span>
              <span id="dash-y"></span>
            </div>
          </header>
          <p class="dash-narrative" id="dash-narrative">
            <span id="dash-network"></span>
            <span id="dash-focus">Focus is not started.</span>
            <span id="dash-usage"></span>
          </p>
        </div>`

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')
      const network = el.querySelector('#dash-network')
      const usage = el.querySelector('#dash-usage')
      const renderStatus = () => {
        network.textContent = ctx.connection.label()
        usage.textContent = ctx.subscription.label()
      }
      ctx.trackCleanup?.(ctx.connection.subscribe(renderStatus))
      ctx.trackCleanup?.(ctx.subscription.subscribe(renderStatus))
      ctx.onTick((now) => {
        wd.textContent = WEEKDAYS_EN[now.getDay()]
        md.textContent = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        year.textContent = String(now.getFullYear())
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
