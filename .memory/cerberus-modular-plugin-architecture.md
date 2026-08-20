---
name: cerberus-modular-plugin-architecture
description: "Open DeskOS 插件化与多尺寸 Widget 架构体系：Plugin Registry、Widget Engine、Hero Navigator、Declarative Composer 与 AI-Ready 规范"
type: project
---

Open DeskOS 实现了完全解耦、组件化、声明式编排的插件操作系统（v2.0）。

**核心模块体系：**
- `core/plugin_registry.lua`：管理插件元数据、多尺寸 Widget、App 生命周期与 Dashboard/Peek 提供者。
- `core/widget_engine.lua`：网格几何与物理尺寸转换（1x1, 2x1, 1x2, 2x2, 3x1, 3x2），统一包装挂载与安全调度。
- `core/hero_navigator.lua`：负责 Widget 绝对坐标到全屏 App 的几何插值与平滑转场动画，解耦 App Runtime。
- `core/pager.lua`：多页面横向容器、状态栏 Page Dots 同步与 RGB565 预渲染快照（保持 60 FPS 滚动）。
- `core/dashboard_engine.lua`：向已注册插件收集叙述流数据，驱动 `dashboard_layout.lua` 的自然语言左对齐流式排版。
- `core/desktop_composer.lua`：解析 `config/desktop_layout.lua` 声明式配置，装配 Dashboard 与 Grid 页面（App Center 概念已归档至 docs/archive/app-center/ 待后续重构）。
- `launcher.lua`：精简为 ~300 行的 Shell Composition Root。

**AI 生成友好规范：**
- 单文件自包含 Plugin 模板（见 `docs/open-deskos/WIDGET_SPEC_AND_AI_GUIDE.md`）。
- 严格遵循 AIODI 设计系统（`aiodi.colors`, `aiodi.px`, `aiodi.icon_label`），严禁使用 SVG 和非标准颜色。
- 热路径严格执行零表分配。

**Why:** 解决了原 97KB 单体 launcher 紧耦合、无法自定网格、缺乏多尺寸组件抽象、Dashboard 封闭以及难以由 AI 生成插件的痛点。

**How to apply:** 新增或生成功能时编写标准 `plugins/<id>.lua`，在 `config/desktop_layout.lua` 中声明摆放位置即可，禁止修改 Shell 核心代码。修改 Lua 模块时保持同名 `.md` 存在。

**Related:** [[aiodi-ui-design-standard]] [[cerberus-native-sdl-sim]] [[cerberus-text-metrics-harness]] [[cerberus-icon-rendering]]

**2026-08-17 审计警示（拆分后遗留）：**
- host 契约套件是 grep 式的：移动/重命名代码必须同步 retarget `tests/host/*_contract.cmake` 的源文件与模式。插件化后 5/20 红（hero×3、home_pager、ui_polish）。
- `hero_navigator` 名存实亡：`efcced5` 起改为 native `load_anim` slide，几何 Hero（create_hero_cover/prepare_hero_scene）已删除；`source_rect` 管线（widget_engine→composer→launcher→navigator `_source_rect`）是死代码。`app-transition.feature` 与 WIDGET_SPEC 文档仍描述几何 Hero，未同步。
- app ctx 尺寸字段是大写 `ctx.WIDTH/HEIGHT`（make_app_context）；apps/almanac.lua 误用小写 `ctx.width` 导致 on_start 崩溃。
- dismiss 双路径不对称：顶部 handle/下拉 → hero_navigator.go_home() 不刷新页面 snapshot；launcher.go_home() 才刷新。快照过期跳变的根因。
- widget 内部容器必须 `set_clickable(false)`，否则吞掉 tile 点击（tap 黑洞在 quota/almanac/calendar/chat/mantra/hydrate 重现）。
