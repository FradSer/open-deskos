;
(function (root) {
  'use strict'

  function lifecycleFor(mount) {
    return {
      install() {}, enable() {}, mount, start() {}, pause() {}, resume() {},
      stop() {}, unmount(el) { el.replaceChildren() }, disable() {}, uninstall() {},
    }
  }

  const app = (id, name, mount, capabilities = [], handleAction = null) => ({
    id: `app-${id}`,
    kind: 'app',
    appId: id,
    app: name,
    name,
    appKind: 'ui',
    source: 'builtin',
    capabilities,
    handleAction,
    lifecycle: lifecycleFor(mount),
  })

  root.odkPlugins.register(app('calendar', '日历', (el) => {
    el.innerHTML = '<div class="runtime-app"><h2>日历</h2><p>今日日期可查看。</p><p class="runtime-state">等待 Mac 日程数据。</p></div>'
  }))
  root.odkPlugins.register(app('clock', '时钟', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><h2>时钟</h2><p class="runtime-value">--:--</p><p class="runtime-state">实时查看本地时间。</p></div>'
    const value = el.querySelector('.runtime-value')
    ctx.onTick((now) => {
      value.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    })
  }))
  root.odkPlugins.register(app('pomodoro', '番茄钟', (el, ctx) => {
    el.innerHTML = '<div class="runtime-app"><h2>番茄钟</h2><p class="runtime-state">未启动</p><button class="button-pill button-primary" type="button">开始计时</button></div>'
    el.querySelector('button').addEventListener('click', () => ctx.emitIntent({
      type: 'action', appId: 'pomodoro', action: 'start',
    }))
  }, [], (intent, context) => {
    if (intent.action !== 'start') return false
    context.platform.setState('pomodoro', '运行中')
    const status = context.runtimeRoot().querySelector('.runtime-state')
    if (status) status.textContent = '运行中'
    return true
  }))
  root.odkPlugins.register(app('year', '年度进度', (el) => {
    el.innerHTML = '<div class="runtime-app"><h2>年度进度</h2><p>年度进度在 Widget 中实时更新。</p></div>'
  }))
  root.odkPlugins.register(app('app-manager', '应用管理', (el, ctx) => {
    const entries = ctx.platform.catalog().map((item) =>
      `<li><strong>${item.name}</strong><span>${item.kind} · ${item.version} · ${item.source} · ${item.state}</span></li>`).join('')
    el.innerHTML = `<div class="runtime-app app-manager"><h2>应用管理</h2><p>统一管理已安装 App，不使用 dock 或桌面图标堆积。</p><ul>${entries}</ul></div>`
  }))
})(typeof window !== 'undefined' ? window : globalThis)
