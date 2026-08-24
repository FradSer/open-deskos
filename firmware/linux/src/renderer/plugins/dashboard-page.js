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
          <p class="dash-narrative" id="dash-narrative">
            <span class="grp">等待你的</span>
            <span class="grp"><b>Mac</b> 连接。</span>
            <span class="grp">连接后，日程会</span>
            <span class="grp">显示在这里。</span>
          </p>
          <p class="dash-support">连接后会显示真实日程与用量。</p>
          <button class="button-pill dash-connect" id="dash-connect" type="button">连接 Mac</button>
        </div>`

      const narrative = el.querySelector('#dash-narrative')
      const support = el.querySelector('.dash-support')
      const connect = el.querySelector('#dash-connect')
      const waitingNarrative = narrative.innerHTML
      const render = (connected) => {
        if (connected) {
          narrative.innerHTML =
            '<span class="grp"><b>Mac</b> 已连接。</span>' +
            '<span class="grp">日程与用量会</span>' +
            '<span class="grp">显示在这里。</span>'
          support.textContent = '已连接到你的 Mac。'
          connect.hidden = true
        } else {
          narrative.innerHTML = waitingNarrative
          support.textContent = '连接后会显示真实日程与用量。'
          connect.hidden = false
        }
      }
      ctx.connection.subscribeBridge(render)

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')
      ctx.onTick((now) => {
        wd.textContent = WEEKDAYS_EN[now.getDay()]
        md.textContent = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        year.textContent = String(now.getFullYear())
      })
      el.querySelector('#dash-connect').addEventListener('click', () => ctx.openCompanionGuide())
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
