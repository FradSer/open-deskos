---
name: cerberus-native-sdl-sim
description: SDL2 480x800 模拟器跑真 lua_module_lvgl+AIODI launcher(无 IDF/emsdk);3 个承重决策(IO+PARTIAL、__EMSCRIPTEN__、sync flush);传 transcript 走真 svc_llm 生成 Lua
type: project
---

Native SDL2 desktop sim at `research/esp32-p4-c6-deskos/firmware/sim/native_sdl/`. Builds with plain CMake + SDL2 — NO ESP-IDF, NO emsdk. Compiles the UNMODIFIED firmware `lua_module_lvgl` C sources + runs `lib/launcher.lua`/`lib/aiodi.lua`.

**Build/run:**
```
cd research/esp32-p4-c6-deskos/firmware/sim/native_sdl
cmake -S . -B build && cmake --build build -j
cp ../../components/lua_modules/lua_module_lvgl/lib/{launcher,aiodi}.lua lib/
cp ../../application/edge_agent/managed_components/lvgl__lvgl/tests/src/test_files/fonts/noto/NotoSansSC-Regular.ttf fonts/
./build/cerberus_sim
```

**Three load-bearing design decisions:**
1. `__EMSCRIPTEN__` defined (NOT for Emscripten — reuses the web sim's contract: `process_events()` drives `lv_timer_handler`, `xTaskCreatePinnedToCore` skipped, FS data_root defaults to "/")
2. **Forced IO + PARTIAL render path** (not device's MIPI_DSI/`esp_lv_adapter`). `sim_main.c` injects `PANEL_IF = lvgl.PANEL_IF_IO` and appends `render="partial"` — dodges the `esp_lv_adapter`/`esp_lcd_dpi_panel_get_frame_buffer` symbols that can't be satisfied without the real adapter.
3. **Synchronous flush terminus**: `esp_lcd_panel_draw_bitmap` → `sim_sdl_blit_rgb565` (SDL_UpdateTexture + RenderPresent) → synchronously fires `on_color_trans_done` → `lv_display_flush_ready`. No deadlock in the simulator's LVGL 9.6 build; the device tree uses LVGL 9.5.

**Modes:**
- `./build/cerberus_sim @path/to.lua` — runs a hand-authored Lua file through the generated-UI pipeline (no LLM)
- `CERB_SIM_SHOT=out.bmp CERB_SIM_SHOT_FRAMES=150` — headless render N frames, save BMP, quit (`sips -s format png out.bmp --out out.png`)
- `CERB_SIM_TAP="x,y@frame[;x,y@frame...]"` — input counterpart to SHOT: inject tap at specific frames, max 8. Common coords: Chat (72,280), Keypad (72,448), Settings (408,616), Back (92,51)
- `./build/cerberus_sim "<transcript>"` — E2E: runs the device's `cerb_voice_ui_run` path host-side, calls real `svc_llm` (libcurl → proxy), generates Lua, runs it. Host LLM ports: `cerb_llm_http_port_t` = libcurl to `http://10.10.0.195:8317/v1/chat/completions` (Bearer sk-dummy; env-overridable `CERB_SIM_LLM_URL`/`CERB_SIM_LLM_KEY`), in-memory KV, local clock.

**Key host-side tweaks (NOT on device):**
- `thinking:{type:disabled}` injected into request body — reasoning models take 2-5 min; disabling drops to ~25s. Override with `CERB_SIM_LLM_REASONING=1`.
- 429 retry (3s/6s/9s backoff, 4 attempts) — Aliyun quota is account-wide; switching models doesn't dodge 429.
- Strengthened system prompt forbidding LVGL C-API names (none exist in Lua binding) — without it the LLM hallucinates them and Lua crashes at `start()`.

**AIODI-consistent generation (landed 2026-07-15):** system prompt byte-identical between sim and device. Requires `require('aiodi')`, builds every UI from AIODI design system. Deterministic linter `voice_ui_lint()` flags off-brand output (missing `require('aiodi')`, hand-rolled `create_screen`, off-palette `'#rrggbb'` literals) and folds violations into ONE corrective re-generation.

**Stubbed out (M1-class UI sim, not full firmware):** wifi/esp-hosted, MCP, IM, audio, C6-OTA. `cap_lua_register_module`/`register_exit_cleanup` are no-ops.

**Host-vs-target honesty:** sim passing ≠ `idf.py build` passing. The sim exercises the IO/PARTIAL path, not the device's MIPI_DSI path. Validates `lua_module_lvgl` C code and the AIODI Lua layer, but not the `esp_lvgl_adapter` or PPA paths.

**Why:** 本地开发无需 IDF/emsdk 即可迭代 AIODI UI 和 Lua 绑定。

**How to apply:** Lua 改只需 re-run, C 改需 cmake --build。传 transcript 走真 LLM 生成, 需本地 proxy 可达。

**Related:** [[aiodi-ui-design-standard]] [[cerberus-firmware-host-vs-idf-build]] [[idf-toolchain-activate]]