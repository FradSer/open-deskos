;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'peek-bridge',
    kind: 'peek',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="peek-primary" id="peek-bridge" role="status" aria-live="polite"></span>
        <span class="peek-secondary" id="peek-network"></span>`

      const bridge = el.querySelector('#peek-bridge')
      const network = el.querySelector('#peek-network')
      ctx.connection.subscribeBridge((connected) => {
        bridge.textContent = connected ? ctx.BRIDGE_LABELS.connected : ctx.BRIDGE_LABELS.disconnected
      })
      ctx.connection.subscribe((online) => {
        network.textContent = ctx.connection.label()
      })
    },

    // Single source of the network guide copy; the peek tap and the quota page's
    // connect action both land here through ctx.openCompanionGuide().
    activate(ctx) {
      ctx.openDialog(
        '连接 Mac',
        '通过网络访问 Mac companion。',
        '连接成功后，真实日程与用量会显示在这里。当前 CM5 切片不含 Mac companion 安装器。',
        true,
        { label: '重新检查状态', onClick: () => ctx.connection.refresh() },
      )
      return true
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
