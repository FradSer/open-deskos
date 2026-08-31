# Open DeskOS Linux Shell — AI 插件生成指南

本切片的外壳是插件化架构:页面、Widget、peek、状态栏和 App 都是自包含插件,摆放由声明式配置驱动。
**AI 生成新功能的唯一正确方式 = 新增一个插件文件 + 在布局配置里声明位置。
UI 只发出 intent;实际动作必须穿过 Installer、App Manager 和 App Runtime。
插件必须实现完整生命周期;不得绕过核心 seam。**

## 文件地图

```
src/renderer/
  index.html               骨架:状态栏/分页视口/peek/app-view 对话框,不含任何页面内容
  shell.js                 组合根:几何、分页器、对话框、键盘导航、核心状态栏
  layout.js                网格几何(Open DeskOS portrait 分支)
  core/registry.js         odkPlugins.register/has/get/ids — 注册表与生命周期
  core/services.js         odkServices — 共享秒级 tick 与连接状态存储、状态文案词汇表
  core/app-platform.js     Installer → App Manager → App Runtime 意图路由
  core/composer.js         odkComposer.validate/build — 把配置装配成 DOM
  config/desktop_layout.js 页面构成与 Widget 摆放的唯一权威
  plugins/*.js             每个页面/Widget/peek/App 一个自包含文件
```

## 插件契约

五种 kind,覆盖外壳所有可见元素:

| kind | 挂载点 | 注册字段 |
|---|---|---|
| `tile` | 网格 Widget(由 desktop_layout.js 声明位置) | `app`、`state`、`interaction`、`appId`、生命周期 |
| `page` | 整页(由 desktop_layout.js 声明) | 生命周期 |
| `status` | 状态栏槽位(`slot: 'left' \| 'right'`) | 生命周期 |
| `peek` | 底部 peek 条内容与点按行为 | 生命周期、`activate` |
| `app` | App Manager 前台验证运行时 | `appId`、`appKind`、生命周期、可选 `handleAction` |

### Widget 插件(kind = tile)

Widget 先陈述真实状态,再按声明延续到对应 App。没有对应 App 时使用
`display-only`;有 App 时使用 `interaction: 'open-app'`。Widget 不直接调用
Runtime,只通过 `ctx.emitIntent()` 发起意图。大部分持续状态由 peek 承担。

```js
;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'my-widget',          // 唯一 id;CSS 类自动为 .w-my-widget
    kind: 'tile',
    app: '我的应用',           // 标识名(data-app),用于唯一性与调试
    state: '待接入',           // 真实状态:待接入 | 未启动 | 实时;绝不伪造"运行中"
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

### 页面插件(kind = page)、状态栏插件(kind = status)、peek 插件(kind = peek)、App 插件(kind = app)

```js
root.odkPlugins.register({
  id: 'my-page',
  kind: 'page',
  mount(el, ctx) { el.innerHTML = `<div class="card my-card">...</div>` },
})

root.odkPlugins.register({
  id: 'my-indicator',
  kind: 'status',
  slot: 'left',             // 'left' 或 'right'
  mount(el, ctx) { /* el 是空槽位 span;订阅 ctx.connection 更新状态 */ },
})

root.odkPlugins.register({
  id: 'my-peek',
  kind: 'peek',
  mount(el, ctx) { /* el 是 peek 按钮内的内容槽位 */ },
  activate(ctx) { ctx.openDialog('标题', '正文', '补充'); return true },
})
```
```

### 完整生命周期

每个插件都必须提供以下阶段: `install`、`enable`、`mount`、`start`、`pause`、
`resume`、`stop`、`unmount`、`disable`、`uninstall`。注册表会补齐无副作用
默认实现;有副作用的插件必须在 `unmount`/`uninstall` 中释放订阅、计时器和运行时资源。
App 额外可以提供 `handleAction(intent, ctx)`;它只能由平台 seam 调度。

### mount 收到的 ctx

| 成员 | 说明 |
|---|---|
| `ctx.onTick(cb)` | 订阅共享 1s tick,订阅即首绘;返回退订函数 |
| `ctx.connection.subscribe(cb)` | 网络状态(true/false),订阅即首绘;返回退订函数 |
| `ctx.subscription.subscribe(cb)` | OpenCode Go 状态和用量快照,订阅即首绘;返回退订函数 |
| `ctx.subscription.refresh()` | 手动从 Linux 主进程重读 OpenCode Go 状态 |
| `ctx.SUBSCRIPTION_LABELS` / `ctx.NETWORK_LABELS` / `ctx.REMOTE_LINK_LABELS` | 统一状态文案,禁止自造 |
| `ctx.openDialog(title, message, sub, showSteps?, action?)` | 打开外壳全屏对话框,可选恢复操作按钮 |
| `ctx.emitIntent({ type: 'open-app', appId, widgetId, route })` | 发起 App 意图,由 Installer → App Manager → App Runtime 路由 |
| `ctx.emitIntent({ type: 'action', appId, action })` | 发起 App 动作,禁止直接调用 Runtime |
| `await ctx.platform.listApps()` | 从主进程 App Manager endpoint 读取权威 App 元数据; IPC 不可用时显示恢复错误 |
| `ctx.platform.catalog()` | 仅供本地适配与测试使用的 renderer 插件目录,不是 App Manager 权威列表 |
| `ctx.openNavigationHelp()` | 打开外壳操作说明视图 |

## 布局声明

在 `config/desktop_layout.js` 的 `pages` 数组里加一项:

```js
{ id: 'home', name: '应用', kind: 'grid', widgets: [
  { id: 'my-widget', col: '3', row: '4' },   // 跨列写 '1 / 3' 这类 grid 线段
]},
{ id: 'my-page', name: '新页', kind: 'page', plugin: 'my-page' },
```

页名会自动进入状态栏页点、`名称 · N/M` 上下文与 aria 标签。

## 上线步骤(AI 按此执行)

1. 先在 `tests/features/linux-shell.feature` 落中文 Gherkin 场景(BDD-first)。
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
- UI 文案与代码禁 emoji;面向用户的文案用中文。
- 插件不得绕过 Installer、App Manager、App Runtime;核心 seam 只负责装配、生命周期和意图路由。
- 状态优先进入 peek;不要用 tooltip-only 控件承载完整状态。
- index.html 保持空骨架:任何页面/磁贴标记出现在其中即失败。
