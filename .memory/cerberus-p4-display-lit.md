---
name: cerberus-p4-display-lit
description: "Guition JC4880P443C 板级权威与 ST7701S 480x800 点屏路径：csvke BSP、直接 MIPI DSI bring-up 与 solid fill"
type: project
---

Guition JC4880P443C 的权威硬件参考是 csvke BSP；不要把其他 P4 carrier 或 LUMINA-P4 的 pin map 套过来。仓库名 `p433c` 与板上丝印 `P443` 指同一块板。

**板级约束：**
- GPIO23 是背光；禁止把 GPIO20–23 按其他板的 I2S map 使用，否则会使面板电源/控制脚失效。
- C6 slave 工程位于 `firmware/open-deskos/application/edge_agent/managed_components/espressif__esp_hosted/slave/`；`network_adapter.bin` 由 `main/cerb_c6_slave_ota.c` 通过 SDIO 更新。

**点屏实现：**
- 控制台走 P4 原生 USB-Serial-JTAG；UART0 不等同于板载 USB-C 调试口。
- `cerb_display_bringup()` 直接初始化 ST7701S MIPI-DSI，并通过 `esp_lcd_panel_draw_bitmap` 做 RGB565 整屏 solid fill，验证真实 PSRAM→DMA→面板路径。
- 当前显示路径使用 2-lane DSI、34MHz DPI、3 个 RGB565 framebuffers 和 TRIPLE_FULL；背光是 GPIO23，面板复位是 GPIO5。
- `main.c` 先运行直接 display bring-up，再启动 touch/app/C6；不要只按 board_manager 默认行为判断面板是否可用。

**Why:** 黑屏问题同时可能来自错误的板级 pin、控制台判断、MIPI 时序或 framebuffer/DMA 生命周期；BSP 权威和直接 solid-fill 闸口把这些问题分开验证。

**How to apply:** 查 Guition 硬件先看 csvke BSP 与 `application/edge_agent/boards/guition/jc4880p443c/`；新板先确认 USB 调试通道、电源、复位、背光、DSI lane 和 timing，再接 LVGL/触摸/应用层。

**Related:** [[idf-toolchain-activate]] [[cerberus-firmware-host-vs-idf-build]] [[cerberus-p4-c6-esp-hosted-up]] [[p4-module-schematic-pins]]
