# Open DeskOS Widget 规格与 AI 生成开发指南 (Widget Spec & AI Generation Guide)

> **目标受众**：人类开发者与 AI Coding Agent（LLM 生成管线）  
> **适用环境**：ESP32-P4、Native SDL 模拟器、LVGL 9.x + Lua 5.1

---

## 1. 插件与 Widget 规范总览

在 Open DeskOS 中，任何功能（无论是系统内置还是 AI 动态生成）均封装为标准的 **Plugin 模块**。
每个插件可以包含：
1. **Manifest**：元数据（名称、图标、主题色、分类等）。
2. **Widgets（多尺寸组件）**：支持 `1x1`、`2x1`、`1x2`、`2x2`、`3x1`、`3x2`、`3x4` 任意组合。
3. **Dashboard Provider（可选）**：为主页流式文字排版提供指标数据。

---

## 2. 尺寸矩阵与设计规范 (AIODI Standards)

Widget 放置在 3x4 竖屏网格中，AIODI 栅格系统会自动为不同尺寸计算物理宽高和坐标：

| 尺寸名 | 网格跨度 | 物理尺寸 (480×800) | 视觉设计要求 | 适合内容 |
|---|---|---|---|---|
| `1x1` | 1×1 格 | 131 × 131 px | 单图标 (48px) 或超大字 (48px) + 极简底色 | 图标入口、计数器、状态指示、开关 |
| `2x1` | 2×1 格 | 286 × 131 px | 水平左右/上下分区，主指标 + 辅助说明 | 时钟+日期、进度条、天气横条、股票单行 |
| `1x2` | 1×2 格 | 131 × 286 px | 垂直流向，垂直柱状/多段状态点 | 水位打卡、垂直电量/信号、待办微列表 |
| `2x2` | 2×2 格 | 286 × 286 px | 黄金比例中卡片，支持圆环仪表/迷你日历/多行内容 | 番茄钟表盘、月历网格、核心状态看板 |
| `3x1` | 3×1 格 | 432 × 131 px | 通栏横幅，宽幅流式数据、多列状态对齐 | 系统总览横条、跑马灯、重要通知 |
| `3x2` | 3×2 格 | 432 × 286 px | 大图表/复合双仪表/复杂图文卡片 | 用量配额详细仪表、黄历大卡片、天气预报 |
| `3x4` | 3×4 格 | 432 × 592 px | 完整页面级卡片 | 独立看板、复杂交互流 |

### 2.1 AIODI 视觉设计铁律
1. **背景与边框**：
   - 卡片背景必须使用 `aiodi.colors.surface` (`#171717`)，或特定饱和色（如强调卡片）。
   - 卡片边框统一使用 `aiodi.colors.stroke` (`#383838`)，宽度为 `g.stroke` (2px)，圆角为 `g.radius` (24px)。
2. **文字与排版**：
   - 主文字颜色为 `aiodi.colors.primary` (`#ffffff`)，次要/说明文字为 `aiodi.colors.secondary` (`#706f70`)。
   - 大数字使用 `aiodi.font_bold(size)`，中文正文使用 `aiodi.font(size)`。
3. **图标渲染**：
   - 统一使用 `aiodi.icon_label(parent, { name = "...", size = ..., color = ... })`。
   - 禁止使用 SVG 渲染（LVGL 软件矢量在 P4 上输出空白）。可用图标：`mail`, `calendar`, `settings`, `tasks`, `hourglass`, `bell`, `bolt`, `dice`, `droplet`, `star`, `leaf`, `link`, `radar`, `arrow-big-left`, `caret-left`。

---

## 3. 单文件自包含插件模板 (Single-File Plugin Template)

这是推荐给 AI 生成或第三方开发者编写的**单文件自包含插件标准模板**：

```lua
-- plugins/demo_app.lua
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

-- 1. 插件清单
Plugin.manifest = {
    id = "demo",
    name = "Demo Counter",
    version = "1.0.0",
    desc = "Simple Click Counter",
    icon = "star",
    accent = aiodi.colors.blue,
    category = "utilities",
}

-- 2. 默认状态
Plugin.state_defaults = {
    count = 0,
}

-- 3. Widget 组件集合
Plugin.widgets = {
    -- 1x1 极简组件
    ["1x1"] = function(parent, spec, ctx)
        local state = ctx.state
        local root = aiodi.card(parent, {
            w = spec.w, h = spec.h,
            pad = 0,
        })
        root:set_flex({ flow = "column", main = "center", cross = "center" })

        local num_label = aiodi.label(root, {
            text = tostring(state.count or 0),
            font = aiodi.font_bold(aiodi.px(48)),
            color = aiodi.colors.primary,
        })

        local sub_label = aiodi.label(root, {
            text = "CLICKS",
            font = aiodi.font(aiodi.px(16)),
            color = aiodi.colors.secondary,
        })

        return {
            root = root,
            on_tick = function(tick_ctx)
                num_label:set_text(tostring(tick_ctx.state.count or 0))
            end,
        }
    end,

    -- 2x1 宽版组件
    ["2x1"] = function(parent, spec, ctx)
        local state = ctx.state
        local root = aiodi.card(parent, {
            w = spec.w, h = spec.h,
            pad = aiodi.space.md,
        })
        root:set_flex({ flow = "row", main = "space_between", cross = "center" })

        local left_col = lvgl.container(root, { bg_opa = 0, border_width = 0, pad = 0 })
        left_col:set_flex({ flow = "column", main = "center", cross = "start" })
        aiodi.label(left_col, {
            text = "Total Count",
            font = aiodi.font(aiodi.px(20)),
            color = aiodi.colors.secondary,
        })
        local num_label = aiodi.label(left_col, {
            text = tostring(state.count or 0),
            font = aiodi.font_bold(aiodi.px(40)),
            color = aiodi.colors.primary,
        })

        local btn = aiodi.pill_button(root, {
            text = "+1",
            w = aiodi.px(80), h = aiodi.px(48),
            bg_color = aiodi.colors.blue,
        })
        btn:on("clicked", function()
            state.count = (state.count or 0) + 1
            num_label:set_text(tostring(state.count))
        end)

        return {
            root = root,
            on_tick = function(tick_ctx)
                num_label:set_text(tostring(tick_ctx.state.count or 0))
            end,
        }
    end,
}

-- 4. Dashboard 提供者 (可选)
Plugin.dashboard = {
    metric_key = "demo_count",
    get_value = function(state, now)
        return string.format("%d clicks", state.count or 0)
    end,
    icon = 0xF005, -- star glyph
}

return Plugin
```

---

## 4. 面向 AI (LLM) 的生成 Prompt 约束与规范

当要求 AI 生成一个 Open DeskOS 插件或小组件时，必须输入以下严格约束：

### 4.1 核心约束 Prompt 模板
```text
You are generating a standalone Open DeskOS plugin in Lua.
The environment runs on ESP32-P4 with LVGL 9.x and the AIODI design system.

STRICT RULES:
1. Return ONLY valid Lua code that returns the Plugin table.
2. Must require("aiodi") and require("lvgl").
3. NEVER call raw LVGL C APIs or methods that do not exist in the Lua binding.
4. Colors MUST use aiodi.colors (e.g. aiodi.colors.bg, aiodi.colors.surface, aiodi.colors.primary, aiodi.colors.stroke). NEVER invent arbitrary hex colors.
5. All layout sizes MUST use aiodi.px(...) or aiodi.space, aiodi.radius.
6. Icons MUST use aiodi.icon_label(parent, { name = "...", size = ..., color = ... }). Never use SVG.
7. Hot paths (such as on_tick) MUST NOT allocate Lua tables (avoid table churn / GC pauses).
8. The plugin must export `manifest`, `state_defaults`, `widgets` (supporting at least "1x1" and "2x1" or "2x2").
```

### 4.2 常见错误与禁忌表 (Anti-Patterns)

| 禁忌做法 | 产生后果 | 正确替代方案 |
|---|---|---|
| 尝试创建 SVG 控件或调用 `aiodi.svg_icon` | P4 上渲染为空白 | 使用 `aiodi.icon_label` (FontAwesome 字体渲染) |
| 手写 `#1a2b3c` 随意颜色 | 破坏 AIODI 一致性，Linter 拦截报错 | 使用 `aiodi.colors.surface`、`aiodi.colors.primary` 等标准 token |
| 在热路径 `on_tick` 中不断 `local t = { ... }` | 造成频繁 GC 停顿，出现微卡顿 | 预先分配/复用局部变量，或通过多返回值传递数值 |
| 试图对 `lvgl.container` 反复 `on("clicked")` | 事件回调累积，导致逻辑多次触发 | 只在初始化时注册一次事件回调 |
| 在全局作用域直接声明未保护的全局变量 | 污染全局环境，导致多插件冲突 | 全部声明为 `local` 变量或挂载在 `ctx.state` 命名空间中 |

---

## 5. 组合与编排指南 (Composition Guide)

用户或 AI 可以通过修改 `config/desktop_layout.lua`，将任意已注册插件的任意尺寸 Widget 自由组合到任意页面的任意网格槽位中。

例如：组合一个极简专注桌面：
```lua
return {
    {
        type = "grid",
        title = "Focus Desk",
        items = {
            { plugin = "clock",    widget = "2x1", col = 1, row = 1 },
            { plugin = "settings", widget = "1x1", col = 3, row = 1 },
            { plugin = "pomodoro", widget = "2x2", col = 1, row = 2 },
            { plugin = "hydrate",  widget = "1x2", col = 3, row = 2 },
            { plugin = "mantra",   widget = "3x1", col = 1, row = 4 },
        }
    }
}
```
引擎会自动计算几何位置、实例化各 Widget、绑定点击触发 Widget 内联动作，并在页面可见时调度其 `on_tick` 刷新。
