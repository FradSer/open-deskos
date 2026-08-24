;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'pomodoro',
    kind: 'tile',
    app: '番茄钟',
    state: '未启动',
    mount(el) {
      el.innerHTML = `
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="50"/>
          <circle class="ring-arc" cx="60" cy="60" r="50"/>
        </svg>
        <span class="ring-mmss">--:--</span>
        <span class="w-name">${this.app}</span>
        <span class="w-state">${this.state}</span>`
    },

    // Tile-specific activation: the pomodoro owns its "not running" copy.
    activate(ctx) {
      ctx.openDialog(this.app, `${this.app}尚未启动。`, '返回桌面继续浏览；启动控制将在此平台接入后提供。')
      return true
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
