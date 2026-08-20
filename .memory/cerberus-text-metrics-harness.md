---
name: cerberus-text-metrics-harness
description: "Lua font measure/line-height/glyph_bounds API、adaptive Dashboard 左对齐叙述布局与 LLM 生成 UI 验证规则"
type: project
---

LVGL Lua binding 提供 `font:measure(text[, max_width])`、`font:line_height()` 和 `font:glyph_bounds(one_codepoint)`（advance、bitmap bounds、bearing、baseline）；Dashboard 的共享几何模型在 `lib/dashboard_layout.lua`，launcher 与 `tests/host/dashboard_layout_harness.lua` 都消费它，避免静态契约和真实布局漂移。native simulator 的 `measure_text.lua`、`verify_layout.lua` 用实际字体指标验证 launcher 布局。委托 LLM 生成 Lua UI 时，必须同时检查模块/函数引用是否非 nil。

**规则：**
- 行高和换行高度从字体 API 派生，不用 `aiodi.px()` 猜测文字占用。
- 修改首页卡片、字体档位或文案后运行相应的 layout harness，检查容器总高和文本宽度；Dashboard 使用 `tests/host/dashboard_layout_harness.lua`，以 480px 画布、FontAwesome 实际 glyph bitmap bounds 和默认 `99 events,` / `99 tasks` / `99 habits` / `99 focus` 验证四条日程叙述行。`small_values` 保留低计数 fixture，用于验证不需要缩放的首选字级。当前 26-unit reference 字号在 480px P4 上实测为约 39px，icon 为 26-unit reference（约 39px）；所有行必须保持在 480px 内。
- Dashboard 每行必须自然左对齐：`You have 99 events,`、`[tasks] 99 tasks and`、`[habit] 99 habits`、`today. You're`、`mostly free`、`after 4 pm.`、`[focus] 99 focus` 是连续的语义 group。flow planner 必须按真实测量宽度向当前行持续追加 group；**只在下一个 group 放不下时换行**，绝不可由旧的固定 row template 提前断行。因此 `99 habits` 后容得下 `today. You're` 时，两者必须同一行。fragment 使用实际测量宽度与正文同一字体的一个实际空格宽度连续排列。禁止为撑满 480px 使用 `space_between`，因为它会在逗号、句号和词语后产生不自然的大空隙。events/tasks/habit/focus **全部保留 inline FontAwesome 图标**；符号使用 20-unit icon scale，每个图标仅占用其实际 glyph bitmap 宽度加 2px icon/text gap，不使用会挤压文本的固定宽 slot。events/tasks/habit/focus 是默认占位数据，只有 Focus 可点击进入 Pomodoro；不使用装饰 spacer 或胶囊。**所有 Dashboard 行固定使用 26-unit reference 字级，绝不局部降档。**单一语义 group 不可容纳才以 `...` 缩略，不能裁切文字。
- Baseline 对齐必须由 harness 创建真实 floating LVGL prose/metric labels、读取 `get_pos()` 后，以 `y + line_height - base_line` 验证共同物理 baseline；禁止只比较预先计算的 y 值。FontAwesome icon 按 glyph bitmap bounds 居中后统一使用 `icon_optical_offset_y=2` 向下作视觉修正，harness 同时验证该偏移。
- 生成 UI 后运行布局验证和 simulator/host 测试；生成成功不等于设备运行正确。
- Dashboard harness 必须分别验证 small、默认 99-count、extreme 三种 planner 输出：每一行均保持首选 26-unit reference；默认和 extreme 都按连续 flow group 策略重排，单一不可容纳 atom 才以 `...` 缩略。每个输出都需验证真实 rendered prose/metric baseline、每个实际 icon label frame、容器宽度和垂直预算，并读取真实 item x 坐标以断言首 fragment 在 x=0、相邻 fragment 恰为前者测量宽度加正文测得的一个 word-space；默认首行必须恰有两段且同一行包含 `You have` + `99 events,`，默认 habits 与 `today. You're` 必须在同一行；只测一组最终字符串不够。
- 代理 endpoint、token 或模型名属于外部配置，不写进产品代码，也不为缺失配置添加硬编码 fallback。

**Why:** 固定行高和 LLM 生成的 nil 引用都会导致 P4 UI 重叠、裁剪或启动崩溃；FontAwesome advance 含有不对称 bearing，必须用实际 bitmap bounds 才能使 icon 肉眼居中；同一叙述区混用字号会破坏阅读节奏，而固定模板换行和 LVGL 的不可控 wrap/crop 都会破坏读序。逐组测量、连续填充、固定共享字级与最后的显式缩略可保持正常页面可读，同时保证任何输入不会逃出容器。共享 spec 能把这些问题挡在设备之前。

**How to apply:** 新布局先由 `dashboard_layout.plan(metrics, values)` 生成渲染行；launcher 只渲染 plan，按 values signature 变化时清空重建，禁止重定义字号、padding 或自己决定折行。以共享 26-unit reference 逐个测量并向当前行追加 declared flow group；候选行超宽才从该 group 开始新行。只在单一 group 不可容纳时做 `...` 缩略。Dashboard 图标使用 fixed slot，以 `glyph_bounds()` 的 `box_w/box_h/ofs_x/ofs_y/base_line` 求得实际 bitmap frame，加 shared `icon_optical_offset_y=2`；harness 需读取实际 labels 的 `get_pos()`。每次修改后先跑 runnable CTest harness、simulator 和 host tests，再刷真机。

**Related:** [[cerberus-native-sdl-sim]] [[aiodi-ui-design-standard]] [[cerberus-real-subscription-data-p4]]
