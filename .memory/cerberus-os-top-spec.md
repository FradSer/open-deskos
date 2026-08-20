---
name: open-deskos-top-spec
description: "OPEN-DESKOS.md 是产品权威；P4+C6 主线、Guition 480x800 优先板与 CM5/S31 独立迁移候选"
type: project
---

`docs/open-deskos/OPEN-DESKOS.md` 是 Open DeskOS 的产品定位和路线图权威；旧的 PROJECT-Open DeskOS 与 SPEC-MVP 内容若冲突，以它和当前固件树为准。

**当前架构：**
- P4+C6 仍是 Open DeskOS 主线：P4 负责 UI、USB、应用编排，C6 负责 esp-hosted 网络和 ESP-NOW 桥接。
- 优先硬件是 Guition JC4880P443C 的 ST7701S MIPI-DSI 480×800 竖屏，已在固件中点亮；262×928 CO6300 AMOLED 仍是暂停分支。
- Widgets 采用声明式 LVGL/Lua 视图和数据快照，保持单一 LVGL owner。
- Orange Pi CM5/RK3588S + ESP32-S31 只是独立迁移候选，不替换 P4+C6，也不作为运行时回退。详见 [[cerberus-rpi-migration-eval]]。

**Why:** 产品定位、优先板和迁移路线曾在多份文档中漂移；后续实现需要一个明确的权威层级和硬件边界。

**How to apply:**
- 产品范围或路线图冲突时先读 `docs/open-deskos/OPEN-DESKOS.md`。
- P4 显示问题按 Guition BSP 和当前 board 配置核对，不把 CO6300 的 pin/时序套到 Guition。
- CM5/S31 方案只修改迁移文档，不把未经验证的 S31 host protocol 写入 P4+C6 实现。

**Related:** [[cerberus-p4-display-lit]] [[cerberus-p4-c6-esp-hosted-up]] [[aiodi-ui-design-standard]]
