---
name: pocketjs-esp32-p4-eval
description: "PocketJS 不替换现役 P4 LVGL+Lua：无 LVGL 后端、P4 真机证据不足且没有内存优势"
type: reference
---

PocketJS 的 P4 支持主要是 native renderer/PPA 编译路径，没有现役 Open DeskOS 所需的 LVGL backend、Guition 480×800 真机验证或完整的 LLM→Lua 管线兼容性。

**Why:** 替换 UI runtime 会丢失已经跑通的 LVGL+Lua+AIODI 生态，而 PocketJS 的内存和硬件支持尚未提供足够收益。

**How to apply:** Open DeskOS 继续使用 LVGL+Lua；未来若要做纯 Rust 原生 UI，只把 PocketJS 的 PPA/RGB565 设计作为参考，不把其 P4 CI 编译结果视为设备验证。

**Related:** [[cerberus-p4-swipe-direct-live]] [[cerberus-native-sdl-sim]]
