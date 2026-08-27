# Repository Guidelines

## Project Structure & Module Organization

This directory contains Open DeskOS firmware for two board-manager targets under
`application/open_deskos/`: Guition JC4880P443C (ESP32-P4 + C6, 480×800
ST7701S MIPI-DSI, GT911) and Waveshare ESP32-S3 Touch LCD 2.8 (240×320
ST7789 SPI, CST328). The production application is `application/open_deskos/`;
shared `claw_*` components remain from the ESP-Claw base. Board scope is pinned
by `tests/features/firmware-scope.feature` and the contracts under `tests/host/`;
read `TRIM.md` for the retained/removed upstream boundary.

Important areas are `components/claw_modules/` (agent core, memory, routing,
skills), `components/claw_capabilities/` (callable capabilities),
`components/lua_modules/` (Lua and hardware bindings), `components/common/app_claw/`
(registration and application shell), `application/open_deskos/boards/` (board
metadata and setup), `application/open_deskos/fatfs_image/` (SYSTEM/DATA image
sources), and `sim/native_sdl/` (desktop LVGL/Lua simulator). Architecture
constraints and known pitfalls are documented in `.agents/design.md` and
`.agents/gotchas.md`; API/spec documents live in `.agents/spec/`.

## Build, Test & Development Commands

Use ESP-IDF 6.0.1 or newer through `eim`:

```sh
cd application/open_deskos
# Guition P4 + C6
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1
# Waveshare S3; keep a separate build tree
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1
```

The `bmgr` step regenerates `components/gen_bmgr_codes/`; rerun it after board
changes or a clean build. Host checks require no ESP-IDF:

```sh
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

The native simulator is `sim/native_sdl/run.sh`. Its host-only renderer does
not validate the production P4 MIPI-DSI adapter or S3 SPI path. For the embedded
settings UI, run:

```sh
cd application/open_deskos/components/http_server/frontend_source
pnpm build
pnpm typecheck
```

When updating the C6 ESP-NOW bridge, build its embedded network image with
`tools/build_c6_espnow_slave.sh` from this directory.

## High-Level Architecture

`application/open_deskos/main/main.c` owns boot and application wiring.
`claw_event_router` matches DATA-root rules and dispatches actions;
`claw_core` builds context, calls the configured LLM backend, executes
capabilities, persists context, and returns responses. The Open DeskOS platform
components under `components/odk_*` provide app generation, installation,
runtime/sandbox, console, subscription, ESP-NOW validation, and LLM services;
`application/open_deskos/main/odk_composition.c` is their composition root.
Keep this core loop narrow. Add model behavior through capabilities, skills,
Lua modules, router rules, or providers. Register capabilities in
`components/common/app_claw/app_capabilities.c` and Lua modules in
`components/common/app_claw/app_lua_modules.c`.

The board manager owns hardware-specific metadata, peripheral YAML, setup code,
defaults, and optional SYSTEM-image overlays. Generic components must not carry
board assumptions. The SYSTEM image is read-only at `/system`; DATA is the
writable runtime root (flash commonly mounts it at `/fatfs`, but SD-backed
boards can use another mount point). Resolve writable paths through `claw_paths`
in C and `storage` helpers in Lua; edit source FATFS trees, never staged build
output. Firmware-baked skill scripts use `{CUR_SKILL_DIR}/scripts/...`; runtime
skills live under DATA and take priority over same-id skills under SYSTEM.
Router rules, schedules, sessions, memory, inbox, and user files belong in DATA;
recovery seeds belong in `/system/.recovery`. Built-in Lua libraries are staged
under `/system/scripts/builtin/lib`.

## Coding Conventions

Use ESP-IDF C-style modules with opaque handles (`xxx_handle_t`), small public
headers, `esp_err_t` APIs, explicit ownership, and synchronization for shared
state. Define private structs in `.c` files; use `xxx_create/delete/start/stop`
patterns and keep task-stack locals below 128 bytes. Put the handle first in
methods, accept `const xxx_config_t *` on create, return `xxx_handle_t *`, and
release all resources in delete. Register callbacks with
`xxx_register_cb(handle, event, user_ctx)`; use an `xxx_ops_t` table for
polymorphism with the base struct first. Keep public APIs and component
dependencies explicit, avoid circular dependencies, and check cleanup paths.
Lua module tests belong beside modules in `components/lua_modules/<module>/test/`;
test apps may live under `components/**/test_apps/`, including application-local
components. Keep generated board-manager code, managed components, SDK config
output, and staged FATFS artifacts out of manual edits.

## Testing & Review

Add or update a Given/When/Then scenario in `tests/features/*.feature` before
behavior changes. Host CTest includes C tests plus contracts such as
`firmware_scope_contract.cmake`, `s3_small_board_contract.cmake`, and
`dashboard_layout_contract.cmake`. Run the relevant board build and host CTest
suite; run both frontend commands for settings UI changes. Before review, state
the board/build target and commands. A host or simulator pass does not prove
the P4 MIPI-DSI display path. The firmware `.pre-commit-config.yaml` keeps
portable whitespace, executable, branch-name, commit-message, and codespell
hooks; run them only after reviewing the firmware-scoped configuration. Never
commit credentials or temporary diagnostics.

## Common File Locations

- Boot and application wiring: `application/open_deskos/main/main.c`
- Capability registration: `components/common/app_claw/app_capabilities.c`
- Lua registration: `components/common/app_claw/app_lua_modules.c`
- App configuration: `application/open_deskos/components/app_config/`
- Board definitions: `application/open_deskos/boards/`
- Host contracts and BDD: `tests/host/` and `tests/features/`
- Guition display-performance reference: `../../docs/reference/guition-lvgl-60fps-path.md`
