;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'peek-bridge',
    kind: 'peek',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="peek-primary" id="peek-bridge">${ctx.BRIDGE_STATUS}</span>
        <span class="peek-secondary" id="peek-network"></span>`

      const network = el.querySelector('#peek-network')
      ctx.connection.subscribe((online) => {
        network.textContent = ctx.connection.label()
      })
    },

    // Single source of the USB guide copy; the peek tap and the quota page's
    // connect action both land here through ctx.openUsbGuide().
    activate(ctx) {
      ctx.openDialog('Mac companion', '通过 USB 连接 Mac companion。', '当前 CM5 切片尚未配置桥接；当前切片不含 Mac companion 安装器。', true)
      return true
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
