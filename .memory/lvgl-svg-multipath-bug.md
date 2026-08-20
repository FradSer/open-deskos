---
name: lvgl-svg-multipath-bug
description: "LVGL/ThorVG build 只渲染多 path SVG 的最后一个 path; create-opts bg_color 被忽略(set_style 才有)"
type: project
---

**已知 LVGL 构建限制:**
1. 该 LVGL/ThorVG build 只渲染多 path SVG 的最后一个 `<path>` — 中间路径被丢弃。
2. `create` opts 的 `bg_color` 被忽略(必须用 `set_style` 设置背景色)。

**How to apply:** 多色 logo 用叠加容器实现(多个单色层叠在一起), 而非多 path SVG 文件。背景色用 `set_style({bg_color=...})` 设置, 不在 `create` opts 中指定。

**Why:** 这两个 bug 在 2026-07-17 验证 launcher 图标和卡片样式时发现, 导致多色 SVG logo 渲染不完整, 背景色不生效。
