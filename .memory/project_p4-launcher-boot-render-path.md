---
name: p4-launcher-boot-render-path
description: P4 MIPI-DSI launcher must use the default esp_lv_adapter TRIPLE_FULL path; explicit partial rendering can hang LVGL startup and leave the display black
type: project
---

On the ESP32-P4 MIPI-DSI display, omit the `render` option in `lvgl.init`. An explicit `render='partial'` selects the hand-rolled buffer path; its PSRAM-backed buffers can hang during LVGL display setup and produce a brief flash followed by a black screen. With no render override, `lua_module_lvgl` selects `esp_lv_adapter` TRIPLE_FULL, which uses the panel's framebuffers and allows the launcher to start.

**Why:** The adapter path matches the P4 MIPI-DPI framebuffer ownership and avoids the partial renderer's incompatible buffer setup. The failure happens before normal launcher rendering, so debugging Lua plugins alone can misdiagnose it.

**How to apply:**
- For P4 MIPI-DSI/RGB production startup, leave `render` unset unless a hand-rolled path has been independently validated.
- Confirm the boot log contains LVGL adapter initialization, `TRIPLE_FULL`, launcher startup, plugin loading, and desktop creation.
- Keep the native SDL simulator's explicit IO/PARTIAL path treated as a host-only path; simulator success does not validate the device adapter path.

**Related:** [[idf-toolchain-activate]] [[cerberus-p4-display-lit]] [[cerberus-p4-swipe-direct-live]] [[cerberus-native-sdl-sim]]
