;
(function (root) {
  'use strict'

  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']

  root.odkPlugins.register({
    id: 'dashboard-page',
    kind: 'page',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="dash">
          <header class="dash-head">
            <div class="dash-wd"><span id="dash-wd"></span><span class="dash-dot"></span></div>
            <div class="dash-date">
              <span id="dash-md"></span>
              <span id="dash-y"></span>
            </div>
          </header>
          <p class="dash-narrative">
            <span class="grp">等待你的</span>
            <span class="grp"><b>Mac</b> 连接。</span>
            <span class="grp">连接后，日程会</span>
            <span class="grp">显示在这里。</span>
          </p>
        </div>`

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')
      ctx.onTick((now) => {
        wd.textContent = WEEKDAYS_EN[now.getDay()]
        md.textContent = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        year.textContent = String(now.getFullYear())
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
