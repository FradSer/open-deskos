---
name: lvgl-lua-binding-part0-ceiling
description: "set_style 只写 LVGL part 0, arc knob/indicator/bar 填充从 Lua 够不着; 已加 interactive=false + clip_corner=1 两个加法式出口"
type: project
---

`lua_module_lvgl` 的 `set_style` 只写 LVGL part 0 (全部件路径), 导致 arc 旋钮/指示器、bar 填充等"主题拥有"的部件从 Lua 完全够不着。

**现有出口:**
- `interactive=false` 在 `create` opts 加 `LV_OBJ_FLAG_CLICKABLE` 的反向 — 不进 click 状态, 避免 pressed 态样式覆盖。
- `clip_corner=1` 在 `create` opts 加 `LV_OBJ_FLAG_CLIP_CORNER` — 圆角卡片裁剪子对象。
- 该绑定是 esp-claw 的薄绑定, 只暴露了部分 LVGL API。arc 角度只能在构造时给。

**Why:** esp-claw 的 Lua 绑定只暴露 LVGL part 0, 子 part 的样式从 Lua 不可写。

**How to apply:** 若需设置 arc/bar 的子 part 样式, 需扩展 C 绑定或改用其他方式(如叠加容器模拟)。现有 `interactive=false` 和 `clip_corner=1` 是加法式出口, 不改绑定。

**Related:** [[cerberus-native-sdl-sim]] [[cerberus-p4-swipe-direct-live]]