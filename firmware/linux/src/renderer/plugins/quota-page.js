;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'quota-page',
    kind: 'page',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="card quota-card">
          <div class="quota-title">OpenCode Go 用量</div>
          <div class="quota-state" id="quota-state"></div>
          <div class="quota-actions">
            <button class="button-pill" id="quota-connect" type="button">查看 USB 连接说明</button>
            <button class="button-pill button-secondary" id="quota-refresh" type="button">重新检查状态</button>
            <button class="button-pill button-secondary" id="quota-help" type="button">操作说明</button>
          </div>
        </div>`

      const state = el.querySelector('#quota-state')
      ctx.connection.subscribe((online) => {
        state.textContent = `${ctx.BRIDGE_STATUS} · ${online ? ctx.NETWORK_LABELS.connected : ctx.NETWORK_LABELS.disconnected}`
      })

      el.querySelector('#quota-connect').addEventListener('click', () => ctx.openUsbGuide())
      el.querySelector('#quota-refresh').addEventListener('click', () => ctx.connection.refresh())
      el.querySelector('#quota-help').addEventListener('click', () => ctx.openNavigationHelp())
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
