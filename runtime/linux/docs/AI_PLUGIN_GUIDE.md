# Open DeskOS Linux Shell — Built-in View Extension Guide

This CM5 Desk Companion slice uses plugins for pages, Widgets, status indicators, and focused built-in views. Placement is declarative.
**The only supported way to add a visible capability is a plugin file plus a placement declaration. UI emits an intent; the current main-process endpoint and renderer runtime own the built-in-view seam. This is not an installable app platform. Plugins must implement the complete lifecycle and must not bypass the core seam.**

## 文件地图

```
src/renderer/
  index.html               骨架:状态栏/分页视口/app-view 对话框,不含任何页面内容
  shell.js                 组合根:几何、分页器、对话框、键盘导航、核心状态栏
  layout.js                网格几何(Open DeskOS portrait 分支)
  core/registry.js         odkPlugins.register/has/get/ids — 固定内建可见元素的注册表与挂载清理
  core/services.js         odkServices — 共享秒级 tick 与连接状态存储、状态文案词汇表
  core/app-platform.js     内建视图意图路由
  core/composer.js         odkComposer.validate/build — 把配置装配成 DOM
  config/desktop_layout.js 页面构成与 Widget 摆放的唯一权威
  plugins/*.js             每个页面/Widget/status/App 一个自包含文件
```

## 插件契约

四种 kind,覆盖外壳所有可见元素:

| kind | 挂载点 | 注册字段 |
|---|---|---|
| `tile` | 网格 Widget(由 desktop_layout.js 声明位置) | `app`、`state`、`interaction`、`appId`、生命周期 |
| `page` | 整页(由 desktop_layout.js 声明) | 生命周期 |
| `status` | 状态栏槽位(`slot: 'left' \| 'right'`) | 生命周期 |
| `app` | App Manager 前台验证运行时 | `appId`、`appKind`、生命周期、可选 `handleAction` |

### Widget 插件(kind = tile)

Widget 先陈述真实状态,再按声明延续到对应 App。没有对应 App 时使用
`display-only`;有 App 时使用 `interaction: 'open-app'`。Widget 不直接调用
Runtime,只通过 `ctx.emitIntent()` 发起意图。持续状态应进入常驻 State Bar 或对应页面。

```js
;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'odk.tile.my-widget', // 唯一、受控的 Open DeskOS id;CSS 类自动为 .w-my-widget
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'My view',           // English identifier(data-app), used for uniqueness and diagnostics
    state: 'Pending integration', // truthful state; never fabricate a running or personal-data status
    interaction: 'display-only', // 或 open-app;由平台 seam 处理
    appId: null,
    mount(el, ctx) {          // el 是展示用 <div class="widget">,往里建自己的 DOM
      el.innerHTML = `
        <svg data-tabler="star" aria-hidden="true" ...>...</svg>
        <span class="w-name">${this.app}</span>
        <span class="w-state">${this.state}</span>`
      ctx.onTick((now) => { /* 每秒回调;需要时钟就订阅,不要自开 setInterval */ })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
```

### 状态栏插件(kind = status) — 常驻系统顶栏能力

系统顶部状态栏（Status Bar）是提供给开发者的常驻全局能力。状态栏插件通过 `slot: 'left' | 'right'` 挂载，无论用户当前在 Today 日报、Home 桌面还是 Usage 用量页，都始终常驻可见。可以用于网络连接指示、时间指示、或像 `odk.status.pi-sessions` 一样显示实时微型指标，并支持点按发起 `ctx.emitIntent({ type: 'open-app', appId })` 直达全屏 App:

```js
root.odkPlugins.register({
  id: 'odk.status.my-indicator',
  manifest: { schemaVersion: 1 },
  kind: 'status',
  slot: 'left',             // 'left' 或 'right'
  mount(el, ctx) {
    el.innerHTML = `<button type="button" class="sb-pi-status flex items-center">...</button>`
    el.querySelector('button').addEventListener('click', () => {
      ctx.emitIntent({ type: 'open-app', appId: 'my-app', widgetId: 'odk.status.my-indicator', route: 'today' })
    })
  },
})
```

### 页面插件(kind = page)、App 插件(kind = app)

```js
root.odkPlugins.register({
  id: 'odk.page.my-page',
  manifest: { schemaVersion: 1 },
  kind: 'page',
  mount(el, ctx) { el.innerHTML = `<div class="card my-card">...</div>` },
})
```

### 挂载与清理

插件只需要 `mount(el, ctx)`；如创建订阅、计时器或其他资源，提供 `unmount(el, ctx)`
释放它们。注册表为缺省 `unmount` 提供无副作用实现。App 可提供
`handleAction(intent, ctx)`，但只能由内建视图 seam 调度。

### mount 收到的 ctx

| 成员 | 说明 |
|---|---|
| `ctx.onTick(cb)` | 订阅共享 1s tick,订阅即首绘;返回退订函数 |
| `ctx.connection.subscribe(cb)` | 网络状态(true/false),订阅即首绘;返回退订函数 |
| `ctx.subscription.subscribe(cb)` | OpenCode Go 状态和用量快照,订阅即首绘;返回退订函数 |
| `ctx.subscription.refresh()` | 手动从 Linux 主进程重读 OpenCode Go 状态 |
| `ctx.SUBSCRIPTION_LABELS` / `ctx.NETWORK_LABELS` / `ctx.REMOTE_LINK_LABELS` | 统一状态文案,禁止自造 |
| `ctx.openDialog(title, message, sub, showSteps?, action?)` | 打开外壳全屏对话框,可选恢复操作按钮 |
| `ctx.emitIntent({ type: 'open-app', appId, widgetId, route })` | 发起内建视图意图，由主进程 endpoint 和 renderer runtime 处理 |
| `ctx.emitIntent({ type: 'action', appId, action })` | 发起内建视图动作，禁止直接调用 Runtime |
| `await ctx.platform.listApps()` | 从主进程 App Manager endpoint 读取权威 App 元数据; IPC 不可用时显示恢复错误 |
| `ctx.platform.catalog()` | 仅供本地适配与测试使用的 renderer 插件目录,不是 App Manager 权威列表 |
| `ctx.openNavigationHelp()` | 打开外壳操作说明视图 |

## 布局声明

在 `config/desktop_layout.js` 的 `pages` 数组里加一项:

```js
{ id: 'home', name: 'Home', kind: 'grid', widgets: [
  { id: 'odk.tile.my-widget', col: '3', row: '4' },
]},
{ id: 'my-page', name: 'My page', kind: 'page', plugin: 'odk.page.my-page' },
```

页名会自动进入状态栏页点、`名称 · N/M` 上下文与 aria 标签。

## 上线步骤(AI 按此执行)

1. Start with an English Gherkin scenario in `tests/features/linux-shell.feature` (BDD-first).
2. 新增 `src/renderer/plugins/<id>.js`,按上方契约注册。
3. 在 `index.html` 的 `<script>` 列表中按依赖顺序加一行(shell.js 之前)。
4. 在 `config/desktop_layout.js` 声明位置与跨度。
5. 如需图标,使用 Tabler Icons outline 路径并带 `data-tabler="名称"`。
6. 跑验证:

```sh
bash tests/smoke.sh   # 几何/token/骨架纯净/核心无专名
pnpm run e2e          # 交互、可访问性、几何、插件注册表契约
```

7. 在 `tests/e2e.js` 补对应断言后提交(`feat(linux): ...`)。

## 硬性规则

- 颜色只用根 `DESIGN.md` 的 Open DeskOS token(`--odk-*` CSS 变量);禁裸 hex。
- 状态必须诚实:未接入显示待接入,桥接未配置显示未配置,永不伪造数据。
- UI copy and code must not use emoji. All user-visible CM5 shell copy and catalog values are English.
- Every plugin ID uses the `odk.` namespace. Supported kinds are `tile`, `page`, `status`, and `app`; status slots are only `left` or `right`. `open-app` tiles require one valid built-in `appId`; display-only tiles cannot declare one.
- Plugins must not bypass the built-in-view intent seam; the core owns composition, mounting, and routing. Do not describe it as an installable app platform.
- Plugins are packaged local scripts within a verified runtime release. Do not download, execute, or hot-reload third-party plugin or theme code.
- 持续状态优先进入 State Bar、Today 或 Usage;不要用 tooltip-only 控件承载完整状态。
- index.html 保持空骨架:任何页面/磁贴标记出现在其中即失败。
