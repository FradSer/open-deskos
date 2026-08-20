# Open DeskOS 插件与 Widget 系统架构总纲 (Plugin & Widget Architecture)

> **版本**：v2.0.0 (Modular Plugin & Composable Widget Ecosystem)  
> **目标平台**：ESP32-P4 + LVGL 9.x + Lua 5.1 / Luajit / eLua 沙盒  
> **设计系统基准**：AIODI Design System (480×800 Guition 竖屏优先，向后兼容 928×262 横屏)

---

## 1. 架构愿景与设计哲学

Open DeskOS 从单体桌面外壳（Monolithic Launcher）演进为**完全解耦、组件化、声明式编排的插件操作系统**。

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Open DeskOS Shell Core                           │
│  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐ │
│  │ Plugin Registry  │ │  Widget Engine   │ │   App State & Router    │ │
│  │ (Dynamic Load)   │ │ (Multi-size Box) │ │  (Hero & Life Cycle)    │ │
│  └──────────────────┘ └──────────────────┘ └─────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │              Composable Pager & Desktop Layout Engine             │ │
│  │       (Declarative Grid Packing & Narrative Stream Composer)      │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ consumes
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Decoupled Plugin Ecosystem (Lua)                    │
│                                                                        │
│  ┌───────────────────┐  ┌───────────────────┐  ┌────────────────────┐  │
│  │   Clock Plugin    │  │  Pomodoro Plugin  │  │  Calendar Plugin   │  │
│  │ ├─ Widget: 1x1/2x1│  │ ├─ Widget: 1x1/2x2│  │ ├─ Widget: 1x1/2x2 │  │
│  │ └─ App: Fullscreen│  │ ├─ App: Fullscreen│  │ ├─ App: Fullscreen │  │
│  │                   │  │ ├─ Peek: Live Ring│  │ └─ Dash: Events    │  │
│  │                   │  │ └─ Dash: Focus    │  │                    │  │
│  └───────────────────┘  └───────────────────┘  └────────────────────┘  │
│  ┌───────────────────┐  ┌───────────────────┐  ┌────────────────────┐  │
│  │   Quota Plugin    │  │  Almanac Plugin   │  │ AI-Generated Apps  │  │
│  │ ├─ Widget: 2x1/3x2│  │ ├─ Widget: 1x1/3x2│  │ ├─ Self-contained  │  │
│  │ ├─ App: Fullscreen│  │ └─ App: Fullscreen│  │ ├─ Multi-size UI   │  │
│  │ └─ Peek: Token Bar│  │                   │  │ └─ Instant Deploy  │  │
│  └───────────────────┘  └───────────────────┘  └────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### 核心设计原则
1. **单一能力自包含（Self-Contained Plugins）**：
   每一个插件是一个独立的 Lua 模块或目录，封装自身的元数据、多种尺寸 Widget 渲染、全屏 App、底栏 Peek 以及 Dashboard 叙述流数据提供者。
2. **多尺寸小组件体系（Multi-Size Widget Matrix）**：
   Widget 支持严格的栅格化规格：`1x1`、`2x1`、`1x2`、`2x2`、`3x1`、`3x2`、`3x4`（全屏卡片）。Widget 专注 glanceable（一瞥可知）信息展示，点击后可直接通过 Hero 动画进入全屏 App。
3. **声明式桌面组合（Declarative Desktop Composition）**：
   桌面页面不再硬编码在 Shell 中，而是由一份结构清晰的声明式布局清单驱动。无论是出厂预设、用户拖拽，还是 AI 根据用户指令“一键重构桌面”，都只需变更布局配置。
4. **AI 生成友好（AI-Ready Generation Protocol）**：
   插件与 Widget 的接口契约极简、无冗余防御代码、无隐式全局依赖，让 LLM 能以 100% 准确率输出单文件插件并在真机上零报错运行。
5. **嵌入式零开销与高帧率（Zero-Alloc & 60 FPS Lifecycle）**：
   热路径上严格执行零表分配（多返回值/缓存），保持 TRIPLE_FULL + PPA 硬件加速 + 快照分页的流畅体验。

---

## 2. 插件契约与接口规范 (Plugin Contract)

每个插件导出一个标准表结构：

```lua
-- plugins/pomodoro/init.lua 示例
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {
    -- 1. 插件元数据
    manifest = {
        id = "pomodoro",
        name = "Pomodoro",
        version = "1.0.0",
        desc = "Minimal Focus Timer",
        icon = "hourglass",              -- FontAwesome 图标名
        accent = aiodi.colors.red,
        category = "productivity",
    },

    -- 2. 默认状态 (放入 state_store.namespace("pomodoro"))
    state_defaults = {
        session = 25 * 60,
        remaining = 25 * 60,
        today_completed = 0,
    },

    -- 3. 多尺寸 Widget 渲染器集合
    -- 每种尺寸为一个构造函数: function(parent, spec, ctx) -> widget_instance
    widgets = {
        ["1x1"] = function(parent, spec, ctx)
            -- 1x1 小磁贴：显示当前状态图标与微型状态指示
            return create_widget_1x1(parent, spec, ctx)
        end,

        ["2x2"] = function(parent, spec, ctx)
            -- 2x2 大卡片：显示英雄表盘、剩余时间、操作按钮
            return create_widget_2x2(parent, spec, ctx)
        end,
    },

    -- 4. 全屏 App (点击 Widget 或通过 open_app 打开)
    app = {
        on_start = function(ctx) ... end,
        on_tick = function(ctx) ... end,
        on_stop = function(ctx) ... end,
    },

    -- 5. 底栏 Peek 卡片 (可选)
    peek = {
        build = function(parent, app_spec) ... end,
        on_tick = function(ctx) ... end,
    },

    -- 6. Dashboard 叙述流提供者 (可选)
    dashboard = {
        metric_key = "focus",
        get_value = function(state, now)
            return string.format("%d focus", state.today_completed or 0)
        end,
        icon = 0xF254, -- FontAwesome glyph
        on_click = function(ctx)
            ctx.open_app("pomodoro")
        end,
    },
}

return Plugin
```

---

## 3. Widget 规格与网格系统 (Grid & Sizing Matrix)

### 3.1 网格几何模型 (3x4 Portrait Reference)

基于 AIODI 480×800 竖屏画布：
- **列数与行数**：`cols = 3`, `rows = 4`
- **单格基准 (1x1 Cell)**：`cell_w = 131px`, `cell_h = 131px`（1:1 正方形）
- **间距 (Gutter)**：`gutter = 24px`（行列等宽等高）
- **边框与圆角**：`border = aiodi.colors.stroke` (2px), `radius = 24px`
- **背景**：`bg_color = aiodi.colors.surface` (`#171717`)

### 3.2 尺寸矩阵定义 (Dimension Specs)

| 尺寸代码 | 列跨度 × 行跨度 | 像素尺寸 (480×800) | 典型用途 | 示例 |
|---|---|---|---|---|
| `1x1` | 1 col × 1 row | 131 × 131 px | 单一图标 / 计数 / 开关 / 极简入口 | Chat、Dice、Mantra、Settings |
| `2x1` | 2 col × 1 row | 286 × 131 px | 时钟+日期 / 单行指标 / 双数据点 | Clock & Date、Year Progress Bar |
| `1x2` | 1 col × 2 row | 131 × 286 px | 垂直柱状图 / 待办列表 / 天气预报 | Vertical Slider、Daily Water Level |
| `2x2` | 2 col × 2 row | 286 × 286 px | 表盘仪表 / 月历 / 完整操作卡片 | Pomodoro Ring、Month Calendar Grid |
| `3x1` | 3 col × 1 row | 432 × 131 px | 通栏横幅 / 股票行情 / 状态栏条 | Token Quota Banner、Status Ticker |
| `3x2` | 3 col × 2 row | 432 × 286 px | 复合大卡片 / 双仪表 / 通胜黄历 | OpenCode Go Usage Card、Almanac Card |
| `3x4` | 3 col × 4 row | 432 × 592 px | 全屏嵌入 Widget / 独立看板 | Dashboard Full Stream、Music Player |

### 3.3 Widget 实例生命周期接口

每个 Widget 构造函数必须返回一个标准对象：
```lua
{
    root = lvgl_container,          -- 根 LVGL 容器
    target_app = "pomodoro",        -- 点击后打开的 App id（默认）
    on_tick = function(ctx) ... end,-- 定时刷新回调（仅在桌面可见时被调度）
    on_click = function(ctx) ... end,-- 自定义点击回调（如果不打开 App 或需先执行某些逻辑）
    destroy = function() ... end,   -- 销毁清理回调
}
```

---

## 4. 声明式桌面布局系统 (Declarative Desktop)

### 4.1 布局文件格式 (`desktop_layout.lua`)

桌面由一个纯声明式 Lua 数组构成，每个页面由类型和组件清单组成：

```lua
return {
    -- 页面 1：Dashboard 叙述流
    {
        type = "dashboard",
        title = "Today",
        providers = { "calendar", "tasks", "habits", "pomodoro" },
        header = { show_date = true, show_weekday = true },
    },

    -- 页面 2：生产力与小组件网格 (3x4 Grid)
    {
        type = "grid",
        title = "Widgets",
        items = {
            { plugin = "clock",     widget = "2x1", col = 1, row = 1 },
            { plugin = "settings",  widget = "1x1", col = 3, row = 1 },
            { plugin = "calendar",  widget = "1x1", col = 1, row = 2 },
            { plugin = "chat",      widget = "1x1", col = 2, row = 2 },
            { plugin = "almanac",   widget = "1x1", col = 3, row = 2 },
            { plugin = "pomodoro",  widget = "2x2", col = 1, row = 3 },
            { plugin = "year",      widget = "1x2", col = 3, row = 3 },
        },
    },

    -- 页面 3：系统用量与监控仪表
    {
        type = "grid",
        title = "Monitoring",
        items = {
            { plugin = "quota",     widget = "3x2", col = 1, row = 1 },
            { plugin = "almanac",   widget = "3x2", col = 1, row = 3 },
        },
    },
}
```

### 4.2 布局渲染引擎的工作流程
1. **解析 Spec**：计算每项的物理像素矩形 `[x, y, w, h]`。
2. **加载 Widget**：通过 `plugin_registry.get_widget(plugin_id, widget_size)` 获取构造器。
3. **挂载与事件绑定**：
   - 容器挂载到页面上。
   - 自动绑定点击事件：默认调用 `hero_navigator.open(plugin.app, widget.root)`，实现从 Widget 矩形平滑展开至全屏 App 的 Hero 动画。
4. **状态隔离与订阅**：Widget 自动连接到 `state_store.namespace(plugin_id)`。

---

## 5. Dashboard 架构重构 (Composable Narrative Engine)

原 `dashboard_layout.lua` 的强悍文本排版与度量算法予以保留，但将**数据源完全插件化**：

```
┌────────────────────────────────────────────────────────────┐
│                  Dashboard Stream Engine                   │
│                                                            │
│  1. Collect Metrics from Registered Plugins:              │
│     - Calendar: "3 events," (icon: 0xF133)                 │
│     - Tasks:    "2 tasks and" (icon: 0xF046)               │
│     - Habits:   "1 habit" (icon: 0xF0C2)                   │
│     - Focus:    "99 focus" (icon: 0xF254)                  │
│                                                            │
│  2. Run Narrative Flow Planner (26-unit reference scale)   │
│     -> Dynamic text measure & greedy line reflow           │
│                                                            │
│  3. Emit Interactive Flow Atoms:                           │
│     - Tap "99 focus" -> Hero open Pomodoro App             │
│     - Tap "3 events" -> Hero open Calendar App             │
└────────────────────────────────────────────────────────────┘
```

任何第三方插件只需在其 Plugin 描述中提供 `dashboard = { metric_key = "...", ... }`，即可无缝插入 Dashboard 的自然语言叙述流中！

---

## 6. 系统目录组织结构

重构后的固件 Lua 目录结构清晰划分为核心微内核、插件库与设计系统：

```
firmware/open-deskos/components/lua_modules/lua_module_lvgl/lib/
├── aiodi.lua                 # AIODI 视觉规范与基础控件
├── aiodi.md
├── state_store.lua           # 全局状态总线与命名空间存储
│
├── core/                     # Shell 微内核 (解耦原 97KB launcher)
│   ├── plugin_registry.lua   # 插件加载、注册与目录查询
│   ├── widget_engine.lua     # Widget 尺寸计算、实例化与生命周期
│   ├── hero_navigator.lua    # Hero 展开/收回转场引擎
│   ├── pager.lua             # 多页滑动、快照与手势管理
│   ├── dashboard_engine.lua  # Dashboard 流式排版与插件度量收集
│   └── desktop_composer.lua  # 声明式布局解析与桌面装配器
│
├── config/
│   └── desktop_layout.lua    # 声明式默认桌面布局清单
│
├── plugins/                  # 独立插件包 (内置能力)
│   ├── clock/                # 时钟 (2x1, 2x2, App)
│   ├── calendar/             # 日历 (1x1, 2x2, App, Dash Provider)
│   ├── pomodoro/             # 番茄钟 (1x1, 2x2, App, Peek, Dash Provider)
│   ├── quota/                # Token 监控 (2x1, 3x2, App, Peek)
│   ├── year/                 # 年进度 (1x1, 2x1, 1x2, App)
│   ├── almanac/              # 传统黄历 (1x1, 3x2, App)
│   ├── settings/             # 系统设置 (1x1, App)
│   ├── chat/                 # AI 对话 (1x1, 2x1, App)
│   ├── dice/                 # 骰子 (1x1, App)
│   ├── breath/               # 呼吸训练 (1x1, App)
│   ├── hydrate/              # 喝水打卡 (1x1, App)
│   ├── mantra/               # 每日一句 (1x1, App)
│   └── stars/                # 星星收集 (1x1, App)
│
└── launcher.lua              # 精简的 Shell 启动与协调器 (~300 行)
```

---

## 7. 总结

该架构彻底将**UI 外壳、布局编排、业务功能与 AI 生成**分离开来，具备以下决定性优势：
1. **完全解耦**：新增或修改任何 App / Widget 绝不触碰 Launcher 核心代码。
2. **多尺寸灵活布局**：任意 App 可以同时适配 1x1 极简入口与 2x2 深度卡片。
3. **AI 极简生成**：AI 仅需生成单一 Plugin 模块或单一 Widget 描述即可被桌面瞬间装配使用。
4. **稳定高效**：维持热路径零表分配、PPA 硬件加速与 Snapshot Pager 高性能指标。
