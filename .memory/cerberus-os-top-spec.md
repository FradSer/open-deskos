---
name: open-deskos-cm5-product-boundary
description: "CM5/Linux 是当前 Open DeskOS 主体；S3 Remote 与 P4 Camera 是独立验收的架构外设，旧 P4+C6 DeskOS 是保留研究线"
type: project
---

`PRODUCT.md` 是当前 Open DeskOS 的产品权威，当前 runtime 位于 `runtime/linux/`。目标架构以 CM5/RK3588S Linux 为主体；ESP32-S3 Remote Control 与 ESP32-P4 SC2336 Camera Peripheral 是独立硬件验收的架构组成部分。基础 CM5 外壳在任一外设尚未验收时仍保持直接触控和键盘可用。

旧的 P4+C6 DeskOS（P4 UI/HID/voice host、C6 Wi-Fi/ESP-NOW、LVGL/Lua/AIODI shell、Apple USB companion）是以前的平行研究线，整体保留在 `research/esp32-p4-c6-deskos/`，不再定义当前产品的启动路径、UI、发布门或产品范围。它与 `peripherals/esp32-p4-camera/` 不同：后者是 CM5 架构的 Camera Peripheral，不得随旧 P4+C6 DeskOS 研究线归档。

**Why:** P4 既曾是完整 DeskOS 主机、也在当前架构中作为 camera peripheral 使用；不区分两者会使旧板卡假设继续污染 Linux 产品，并可能误归档当前 P4 Camera。

**How to apply:**
- 产品范围或路线图冲突时先读 `PRODUCT.md` 与 `runtime/linux/CONTEXT.md`。
- 改 CM5 runtime 时只依赖明确的 peripheral protocol；缺失外设不可阻断 base shell。
- 改 prior P4+C6 device OS 时在 `research/esp32-p4-c6-deskos/` 内操作；它的技术结论只适用于 research track。
- 改 P4 Camera 时在 `peripherals/esp32-p4-camera/` 内操作，并保持其独立验收边界。

**Related:** [[cerberus-p4-display-lit]] [[cerberus-p4-c6-esp-hosted-up]] [[open-deskos-linux-electron-shell]]
