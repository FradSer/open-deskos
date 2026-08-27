;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'status-apps',
    kind: 'status',
    slot: 'left',
    lifecycle: {
      install() {}, enable() {}, mount(el, ctx) {
        el.innerHTML = '<button id="sb-app-manager" class="status-app-entry" type="button" aria-label="打开应用管理">应用</button>'
        el.querySelector('#sb-app-manager').addEventListener('click', () =>
          ctx.emitIntent({ type: 'open-app', appId: 'app-manager', route: 'installed' }))
      },
      start() {}, pause() {}, resume() {}, stop() {},
      unmount(el) { el.replaceChildren() }, disable() {}, uninstall() {},
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
