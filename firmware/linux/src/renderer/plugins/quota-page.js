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
          <div class="quota-state" id="quota-state" role="status" aria-live="polite"></div>
          <div class="quota-checked" id="quota-checked"></div>
          <div class="quota-actions">
            <button class="button-pill quota-primary" id="quota-connect" type="button">连接 Mac</button>
            <button class="button-pill button-secondary" id="quota-refresh" type="button">重新检查状态</button>
            <button class="button-pill button-secondary" id="quota-help" type="button">操作说明</button>
          </div>
        </div>`

      const state = el.querySelector('#quota-state')
      const checked = el.querySelector('#quota-checked')
      let bridgeConnected = ctx.connection.bridgeConnected()
      let networkOnline = ctx.connection.online()
      const renderState = () => {
        state.textContent = `${bridgeConnected ? ctx.BRIDGE_LABELS.connected : ctx.BRIDGE_LABELS.disconnected} · ${networkOnline ? ctx.NETWORK_LABELS.connected : ctx.NETWORK_LABELS.disconnected}`
        checked.textContent = ctx.connection.lastCheck()
      }
      ctx.connection.subscribeBridge((connected) => {
        bridgeConnected = connected
        renderState()
      })
      ctx.connection.subscribe((online) => {
        networkOnline = online
        renderState()
      })
      renderState()

      el.querySelector('#quota-connect').addEventListener('click', () => ctx.openCompanionGuide())
      el.querySelector('#quota-refresh').addEventListener('click', async () => {
        await ctx.connection.refresh()
        renderState()
      })
      el.querySelector('#quota-help').addEventListener('click', () => ctx.openNavigationHelp())
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
