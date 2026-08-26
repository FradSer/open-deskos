# Open DeskOS Linux Shell — AI 插件生成指南

本切片的外壳是插件化架构:页面和磁贴都是自包含插件,摆放由声明式配置驱动。
**AI 生成新功能的唯一正确方式 = 新增一个插件文件 + 在布局配置里声明位置。
禁止修改外壳核心(`shell.js`、`core/`),`tests/smoke.sh` 会强制这一点。**

## 文件地图

```
src/renderer/
  index.html               骨架:状态栏/分页视口/peek/app-view 对话框,不含任何页面内容
  shell.js                 组合根:几何、分页器、对话框、键盘导航、核心状态栏
  layout.js                网格几何(Open DeskOS portrait 分支)
  core/registry.js         odkPlugins.register/has/get/ids — 插件注册表
  core/services.js         odkServices — 共享秒级 tick 与连接状态存储、状态文案词汇表
  core/composer.js         odkComposer.validate/build — 把配置装配成 DOM
  config/desktop_layout.js 页面构成与磁贴跨列跨行的唯一权威
  plugins/*.js             每个页面/磁贴一个自包含文件
```

## 插件契约

四种 kind,覆盖外壳所有可见元素:

| kind | 挂载点 | 注册字段 |
|---|---|---|
| `tile` | 网格磁贴(由 desktop_layout.js 声明位置) | `app`(标识名)、`state`、`mount` |
| `page` | 整页(由 desktop_layout.js 声明) | `mount` |
| `status` | 状态栏槽位(`slot: 'left' \| 'right'`) | `mount` |
| `peek` | 底部 peek 条内容与点按行为 | `mount`、`activate` |

### 磁贴插件(kind = tile)

磁贴与 ESP32-P4 固件一致是纯展示面:`app`/`state` 只作标识与状态陈述,
点按或键盘激活都不会进入全屏视图;全屏视图仅供 peek 说明、页面内连接入口
与操作说明等外壳级入口经 `ctx.openDialog` 使用。

```js
;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'my-widget',          // 唯一 id;CSS 类自动为 .w-my-widget
    kind: 'tile',
    app: '我的应用',           // 标识名(data-app),用于唯一性与调试
    state: '待接入',           // 真实状态:待接入 | 未启动 | 实时;绝不伪造"运行中"
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

### 页面插件(kind = page)、状态栏插件(kind = status)、peek 插件(kind = peek)

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

### mount 收到的 ctx

| 成员 | 说明 |
|---|---|
| `ctx.onTick(cb)` | 订阅共享 1s tick,订阅即首绘;返回退订函数 |
| `ctx.connection.subscribe(cb)` | 连接状态(true/false),订阅即首绘;返回退订函数 |
| `ctx.connection.refresh()` | 手动重读 |
| `ctx.BRIDGE_STATUS` / `ctx.NETWORK_LABELS` | 统一状态文案,禁止自造 |
| `ctx.openDialog(title, message, sub, showSteps?)` | 打开外壳全屏对话框 |
| `ctx.openNavigationHelp()` / `ctx.openCompanionGuide()` | 内置两个标准视图(网络连接指南文案由 peek 插件提供) |

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
- 不改 `shell.js`/`core/*`;smoke 的 grep 契约会拦下越界改动。
- index.html 保持空骨架:任何页面/磁贴标记出现在其中即失败。
