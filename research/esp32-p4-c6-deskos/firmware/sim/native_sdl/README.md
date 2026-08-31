# Open DeskOS native SDL2 simulator

A native (macOS/Linux + SDL2) build that runs the **same firmware UI sources**
(`lua_module_lvgl` + the AIODI launcher Lua) against an SDL2 window instead of
the Guition JC4880P443C panel, so the OS-shell UI can be iterated without
flashing and without a browser/emsdk. Mirrors `pulse-esp/sim/`.

## Build & run

Requires SDL2 and CMake (`brew install sdl2 cmake` on macOS).

```sh
cmake -S research/esp32-p4-c6-deskos/firmware/sim/native_sdl -B research/esp32-p4-c6-deskos/firmware/sim/native_sdl/build
cmake --build research/esp32-p4-c6-deskos/firmware/sim/native_sdl/build -j
cd research/esp32-p4-c6-deskos/firmware/sim/native_sdl && ./build/open-deskos_sim
```

Or run the complete setup, build, and launch flow from any directory:

```sh
research/esp32-p4-c6-deskos/firmware/sim/native_sdl/run.sh
```

`run.sh` copies the current firmware Lua modules and fonts into the simulator,
configures CMake, builds `open-deskos_sim`, and launches it. The simulator
uses the same Guition JC4880P443C 480×800 UI sources; its host display path is
SDL2 IO/PARTIAL rather than the device's MIPI-DSI path.

### Interactive mode

On macOS, run `./run.sh` directly. SDL uses the native Cocoa window backend,
so `DISPLAY` and `WAYLAND_DISPLAY` are not required. On Linux, an X11 or
Wayland display session is required. A 480×800 portrait window opens running
the AIODI launcher (home icon grid, big-numeral clock, dark theme). Mouse acts
as the touch panel; tapping a tile navigates to its app screen; Back returns
home. Close the window to exit.

### Headless and scripted mode

Set `ODK_SIM_SHOT` to run without a window and save a BMP screenshot:

```sh
ODK_SIM_SHOT=/tmp/opendeskos-sim.bmp \
ODK_SIM_SHOT_FRAMES=30 \
./run.sh
```

`ODK_SIM_TAP` injects scripted touch events in `x,y@frame` form. Multiple
events are separated with semicolons:

```sh
ODK_SIM_SHOT=/tmp/opendeskos-sim.bmp \
ODK_SIM_SHOT_FRAMES=120 \
ODK_SIM_TAP="72,280@30;408,616@70;92,51@100" \
./run.sh
```

`ODK_SIM_DASHBOARD_VALUES=small` or `extreme` selects the corresponding
layout fixture; these switches have no device-side effect. When
`ODK_SIM_SHOT` is set, `run.sh` selects SDL's dummy video driver automatically.

The launcher sources are copied from
`components/lua_modules/lua_module_lvgl/lib/`, including the `apps/` directory.
The build target is `open-deskos_sim`; older references to `cerberus_sim` or
`open_deskos_sim` are obsolete.

## Fonts at runtime

`aiodi.lua` loads both `fonts/NotoSansSC-Regular.ttf` and
`fonts/Montserrat-Bold.ttf` via `lvgl.font_load` (LVGL tiny_ttf).
`sim_main.c` passes `.` as the LVGL FS data root, so the fonts resolve at
`<cwd>/fonts/...`. Copy both fonts into the run directory before launching:

```sh
cp application/open_deskos/fatfs_image/storage/fonts/NotoSansSC-Regular.ttf \
   research/esp32-p4-c6-deskos/firmware/sim/native_sdl/fonts/
cp application/open_deskos/fatfs_image/storage/fonts/Montserrat-Bold.ttf \
   research/esp32-p4-c6-deskos/firmware/sim/native_sdl/fonts/
```

The `run.sh` wrapper performs both copies automatically and changes into the
simulator directory before launching, which keeps the LVGL data root aligned
with the copied assets.

The AIODI launcher (`lib/launcher.lua` + `lib/aiodi.lua` + the `lib/apps/`
app files) ships beside the binary too — copy them from
`components/lua_modules/lua_module_lvgl/lib/`. Include `apps/`: the launcher
`require("apps.pomodoro")`s etc. at module load, so a missing `lib/apps/` fails
the boot with `module 'apps.pomodoro' not found`.

## What it compiles

`CMakeLists.txt` selects only the real `lua_module_lvgl` C sources (the same
file list the Emscripten web sim compiles) and substitutes host shims for the
ESP-IDF/FreeRTOS symbols they call:

- `sim_esp_compat.c` — `esp_lcd_panel_draw_bitmap` (-> SDL texture blit),
  `esp_timer` fire-due, `xSemaphore*`/`vTask*` single-threaded no-ops,
  `heap_caps_*` -> malloc, `display_arbiter` owner state, `cap_lua` no-ops.
- `sdl_driver.c` — SDL2 480x800 portrait window, RGB565 streaming texture,
  mouse -> pointer state for the LVGL touch indev.
- `compat/` — the ESP-IDF header shims (copied verbatim from the web sim's
  `sim/compat/`).
- `sim_main.c` — composition root: registers the real `luaopen_lvgl`, injects
  the `PANEL`/`WIDTH`/`HEIGHT`/`PANEL_IF`/`ICONS` globals the launcher reads,
  patches `lvgl.init` to force `render="partial"`, loads `launcher.lua`, lets
  the Shell Runner invoke its canonical callbacks, and runs the tick loop.

## Render path: IO/PARTIAL, not MIPI_DSI

The Shell Runner calls `lvgl.init(PANEL, nil, W, H, PANEL_IF, {buffer_lines,
tick_ms, task_period_ms})`. On device `PANEL_IF` is `MIPI_DSI`, which routes the
real `lua_lvgl_init` into the `esp_lv_adapter` TRIPLE_PARTIAL path — a path the
host cannot satisfy without the real adapter component.

So the sim injects `PANEL_IF = lvgl.PANEL_IF_IO` and patches `lvgl.init` to
append `render="partial"`, steering `lua_lvgl_init` onto the hand-rolled
PARTIAL path whose only host dependency is `esp_lcd_panel_draw_bitmap` (-> SDL
blit). The MIPI_DSI panel-interface value stays a device-only concern; the sim
renders via the **same LVGL drawing code** as the device, just not the same
display-interface path.

`__EMSCRIPTEN__` is defined for `lua_module_lvgl` in the native sim — not to
pull in Emscripten (there are no `EM_ASM` calls in `lua_module_lvgl`, only
`#ifdef __EMSCRIPTEN__` guards) but to reuse the exact contract the web sim
relies on: `process_events()` drives `lv_timer_handler`, the
`xTaskCreatePinnedToCore` path is skipped, and the LVGL FS data_root defaults
to `"/"`.

## What stays stubbed

Wi-Fi/esp-hosted, LLM (`svc_llm`), MCP, IM platforms, audio codec, and C6 slave
OTA are all no-ops or absent — this sim is for **UI/LVGL iteration**, not the
agent runtime. The `cerb ui "<text>"` voice->LLM->Lua generation path is out of
scope; the sim runs the pre-authored `launcher.lua` directly.

## Honesty: host build != `idf.py build`

Per the project's host-vs-IDF-build caveat (memory
`[[open-deskos-firmware-host-vs-idf-build]]`), this sim building and running on
the host does NOT mean `idf.py build` passes. The sim shares `lua_module_lvgl`
source with the firmware but exercises the IO/PARTIAL render path, not the
device's MIPI_DSI/`esp_lv_adapter` TRIPLE_PARTIAL path. IDF-only traps
(component REQUIRES, `-Werror=format-truncation`, partition tables) are not
exercised here.
