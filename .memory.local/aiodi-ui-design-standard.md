---
name: aiodi-ui-design-standard
description: "设备端 LVGL/Lua OS shell 使用 AIODI 暗色卡片设计系统；token、builder 和生成 linter 必须保持同步"
type: project
---

设备端 UI 遵循 AIODI Figma 设计系统：黑色背景、白/灰文字、红绿蓝强调色、卡片式布局、大号数字和运行时尺寸适配。

**规则：**
- token 修改必须同步 `firmware/open-deskos/components/lua_modules/lua_module_lvgl/lib/aiodi.lua`、`aiodi.md`、`application/edge_agent/main/cerb_voice_ui.c` 和 `sim/native_sdl/sim_voice_ui.c`；后两个文件的 system prompt 与 palette 白名单必须逐字一致。
- 参考画布是 320×480；实际尺寸通过 `M.px()`/`M.grid_metrics()` 适配，不写死设备像素常量。当前优先板是 Guition JC4880P443C 480×800 竖屏。
- launcher 建立在 AIODI builders 上；生成 UI 必须 `require('aiodi')`，不得手写 `create_screen` 或使用未批准的颜色字面量。
- builtin Lua 文件变更后，清理对应 sync stamp 后再重建固件。

**Why:** UI 生成由设备端和 native simulator 两条路径共同执行；token 或 linter 漂移会造成模拟器通过、设备端生成不一致。

**How to apply:** 改 UI token 或 builder 时同步四个实现文件，运行 simulator/linter 和布局验证；保持 Guition 480×800 竖屏与 262×928 横置分支的硬件假设分离。

**Related:** [[cerberus-native-sdl-sim]] [[open-deskos-top-spec]] [[cerberus-p4-display-lit]]
