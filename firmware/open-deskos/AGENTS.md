# Repository Guidelines

This file provides guidance to agents when working with code in this directory.

## Project Overview

Open DeskOS production firmware for the **Guition JC4880P443C** board: ESP32-P4 application processor, ESP32-C6 Wi-Fi/ESP-NOW co-processor, ST7701S MIPI-DSI 480×800 display, GT911 touch. Derived from the upstream ESP-Claw agent framework, so `claw_*` component names persist under `components/`. The main application is `application/open_deskos/`; the only board-manager definition is `application/open_deskos/boards/guition/jc4880p443c/`. See [`README.md`](README.md) for the authoritative hardware/build baseline and [`TRIM.md`](TRIM.md) for the upstream-trimming boundary.

## Development Commands

Use ESP-IDF **6.0.1 or newer** via eim — older IDF versions break the P4 MIPI-DSI display path:

```bash
cd application/open_deskos
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1
```

The board-manager step generates `components/gen_bmgr_codes/`; rerun it after removing the build directory or changing the board definition.

Host tests (no ESP-IDF required):

```bash
cmake -S tests/host -B /tmp/open-deskos-host-build
cmake --build /tmp/open-deskos-host-build -j
ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```

Native SDL2 simulator (no ESP-IDF): `sim/native_sdl/run.sh`. It uses an SDL2 IO/PARTIAL render path — a passing simulator run does not validate the production P4 MIPI-DSI adapter path; run `idf.py build` before flashing hardware.

Embedded settings UI:

```bash
cd application/open_deskos/components/http_server/frontend_source
pnpm build
pnpm typecheck
```

## High-Level Architecture

### Boot and Runtime Flow

The main entry point is `application/open_deskos/main/main.c`.

### Core Data Flow

1. IM channels, scheduler jobs, Lua scripts, startup hooks, or CLI commands publish events or submit requests.
2. `claw_event_router` matches events against the DATA root's `router_rules/router_rules.json` and can call capabilities, run scripts, run the agent, send messages, emit events, or drop events.
3. `claw_core` builds context from memory, session history, skills, and other providers; calls the configured LLM backend; executes capability tool calls; persists context; and returns responses.
4. Outbound messages are routed back through registered IM bindings or local/web channels.

## Key Subsystems

- **Application shell** (`application/open_deskos/main/main.c`, `components/common/app_claw/`): boot flow, storage paths, capability registration, Lua module registration, CLI, and agent startup.
- **Agent core** (`components/claw_modules/claw_core/`): request queue, context building, LLM backend runtime, tool-call loop, media inference, interrupts, context persistence, and response delivery.
- **Event router** (`components/claw_modules/claw_event_router/`): declarative event routing and actions backed by router rules in FATFS.
- **Capability registry** (`components/claw_modules/claw_cap/`): common registration and dispatch layer for model-callable capabilities.
- **Capabilities** (`components/claw_capabilities/`): concrete agent capabilities such as Lua execution, files, IM platforms, MCP, skill management, router management, scheduler, session management, time, HTTP requests, web search, system, and LLM inspection.
- **Memory** (`components/claw_modules/claw_memory/`): session history, profile/long-term memory providers, memory persistence, request gating, and stage notes.
- **Skills** (`components/claw_modules/claw_skill/`, component `skills/` directories): user-facing skill documents and activation state.
- **Lua modules** (`components/lua_modules/`): Lua drivers and higher-level modules for hardware, media, HTTP server, storage, threading, JSON, board manager, and capability calls.
- **Board manager** (`application/open_deskos/boards/`): board metadata, peripheral YAML, board setup code, board defaults, optional local components, and optional board FATFS overlays.
- **FATFS images** (`application/open_deskos/fatfs_image/`): build-time source trees for the read-only SYSTEM image and writable DATA seed image.
- **HTTP config service** (`application/open_deskos/components/http_server/`): local device configuration server and embedded frontend.

### Runtime Path Rules

The firmware uses two logical filesystem roots, configured at boot through `claw_paths`:

- `CLAW_PATH_SYSTEM` is mounted at `/system`. It is read-only and contains firmware-baked skills, skill assets, built-in Lua modules, Lua docs/tests, board image overlays, and `.recovery` seed files.
- `CLAW_PATH_DATA` is the writable storage root. It is `/fatfs` when flash storage is used, or the board-manager SD card mount point when an SD card is available.
- Never hard-code `/fatfs` for writable paths in reusable code or docs. Use `claw_paths_join(CLAW_PATH_DATA, ...)` in C and `storage.get_root_dir()` plus `storage.join_path(...)` in Lua.
- Firmware-baked skill scripts must be referenced with `{CUR_SKILL_DIR}/scripts/...` inside `SKILL.md`; do not write fixed `/fatfs/skills/...` paths.
- Runtime-installed/user skills live under the DATA root's `skills/`. Firmware-baked skills live under `/system/skills/`; the skill registry scans both, with DATA skills taking priority when ids conflict.
- Router rules, scheduler rules, memory, sessions, inbox, and user-generated files live under DATA. Recovery defaults are stored under `/system/.recovery` and copied into DATA only when missing.
- Built-in Lua libraries are staged under `/system/scripts/builtin/lib`; generated Lua module docs/tests are bundled into the `builtin_lua_modules` skill and should be accessed via that skill's `{CUR_SKILL_DIR}` paths.
- Board-specific `boards/<vendor>/<board>/fatfs_image/` content overlays the SYSTEM image at build time. Board image content does not target DATA and hidden board folders are not considered.

## Project-Specific Notes

- Architecture constraints: [`design.md`](.agents/design.md)
- Common gotchas: [`gotchas.md`](.agents/gotchas.md)
- Specs (`.agents/spec/`):
  - lua module spec: [lua-module-spec.md](.agents/spec/lua-module-spec.md)
  - claw skill spec: [claw-skill-spec.md](.agents/spec/claw-skill-spec.md)

## General Engineering Rules

- Use modular design. Each module should have clear responsibilities, ownership, and boundaries.
- Keep source files under 1500 lines where practical; split files by responsibility when they grow beyond that.
- Keep functions focused and reviewable; split large functions instead of adding deeply nested branches.
- Avoid magic numbers and magic strings. Use named constants, enums, macros, Kconfig options, or shared config keys.
- Prefer explicit ownership and explicit data flow over hidden global state.
- Keep public headers small and avoid exposing private implementation details.
- Avoid circular dependencies between components and modules.
- Check return values, handle allocation failures, and clean up partially initialized resources.
- Protect shared mutable state with documented ownership or synchronization.

## Code Style

- Implement the module in ESP-IDF using C-style object-oriented design, not C++.
- Represent each module as an object with an opaque handle: typedef struct xxx_t *xxx_handle_t.
- The header should expose only the handle, config, events, callbacks, and public APIs.
- Define struct xxx_t only in the .c file to store object state and resources.
- Use ESP-IDF-style APIs: xxx_create/delete/start/stop/read/write/set/get.
- Use xxx_handle_t handle as the first parameter of object methods.
- Prefer esp_err_t as the return type for public APIs.
- Use const xxx_config_t *config as create input and xxx_handle_t *ret_handle as output.
- Resources must be allocated in create and fully released in delete.
- Internal resources may include memory, GPIO, I2C, SPI, timers, tasks, queues, and mutexes.
- Protect shared state with mutexes or semaphores when accessed by multiple tasks.
- Register callbacks with xxx_register_cb(), using handle, event, and user_ctx.
- For polymorphism, use an xxx_ops_t function pointer table and put base struct as the first member.

## Memory Allocation and Release

- All runtime states must belong to a certain object instance.
- Avoid creating local variables larger than 128 bytes on task stacks; 
- Pre-allocated buffers, memory pools or ring buffers should be used in high-frequency scenarios.

## Testing

- Firmware changes should at minimum run `eim run "idf.py build" v6.0.1` for the production board after generating board manager config; host CTest suites under `tests/host/` cover the rest without ESP-IDF.
- Component test apps live under `components/claw_modules/*/test_apps/`.
- Lua module tests live beside modules under `components/lua_modules/<module>/test/` with descriptive names such as `json_roundtrip.lua`.
- Embedded frontend changes should run `cd application/open_deskos/components/http_server/frontend_source && pnpm build` and `pnpm typecheck`.

## Common File Locations

- App entry point: `application/open_deskos/main/main.c`
- Capability registration: `components/common/app_claw/app_capabilities.c`
- Lua module registration: `components/common/app_claw/app_lua_modules.c`
- App config schema/storage: `application/open_deskos/components/app_config/`
- Board definitions in use: `application/open_deskos/boards/guition/jc4880p443c/`
- Guition LVGL FPS path (Direct/PPA + next hop `esp_lvgl_adapter` DOUBLE_DIRECT/TRIPLE_PARTIAL): repo-root `docs/reference/guition-lvgl-60fps-path.md`
- Firmware testing rules and host-test contracts: `tests/host/`, BDD scenarios in `tests/features/*.feature`

