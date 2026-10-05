# Repository Guidelines

## Project Structure & Module Organization
This is preserved ESP32-P4+C6 DeskOS research firmware, not the active CM5 runtime. `application/open_deskos/` contains Guition P4+C6, Waveshare S3, and M5Stack PaperColor board-manager targets. `components/claw_*` provides the ESP-Claw base; `components/odk_*` contains historical platform services; `components/lua_modules/` contains Lua and hardware bindings; `sim/native_sdl/` is the desktop Lua/LVGL simulator; host contracts and BDD are in `tests/host/` and `tests/features/`.

## Build, Test & Development Commands
For target builds, use ESP-IDF 6.0.1 through `eim`:
```sh
cd application/open_deskos
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1 && eim run "idf.py build" v6.0.1
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1 && eim run "idf.py -B build-s3 build" v6.0.1
```
Use `build-m5paper` for the `m5papercolor` board. Re-run board-manager generation after removing a build tree or changing boards. For the preserved C6 image, use `tools/build_c6_espnow_slave.sh` from this firmware directory.

Host checks start from this firmware directory, **not** `application/open_deskos/`:
```sh
cmake -S tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure
```
The CTest suite includes a Lua/LVGL layout harness that launches the native simulator; for its SDL2 dependencies or UI work, use @sim/native_sdl/README.md. A passing simulator does not validate target display paths. For the historical settings frontend, run `pnpm build && pnpm typecheck` from `application/open_deskos/components/http_server/frontend_source`.

## Coding Style & Naming Conventions
- 4-space ESP-IDF C, `snake_case`, opaque handles, explicit `esp_err_t` ownership, and small public headers.
- Keep board assumptions in board metadata and setup files, not generic components.
- Preserve `/system` read-only and DATA-root conventions; edit source FATFS trees, never staged build outputs.
- Edit board definitions in `application/open_deskos/boards/`, not generated `application/open_deskos/components/gen_bmgr_codes/`, managed components, SDK config output, or staged FATFS artifacts.

## Testing Guidelines
- Host contracts and fakes are in `tests/host/`; CMake registers `test_*.c` automatically on configure. Use affected CTest cases for host logic and the selected board's ESP-IDF build for target code.
- For formatting/spelling checks, inspect `.pre-commit-config.yaml`; several hooks rewrite files, so scope them to the changed files.
- Distinguish Guition MIPI-DSI, Waveshare SPI, and PaperColor evidence; a passing build for one board does not validate another.


## Component design and filesystem rules

Keep the claw_core iteration loop small. Put feature work in capabilities, Lua modules, skills, router rules, overlays or context providers. Register capabilities in app_capabilities.c and Lua modules in app_lua_modules.c. Update Kconfig/default selection with registration. Keep credentials and storage local to each capability group. Guard hardware modules with board capability checks.

SYSTEM is read-only. Stage shared defaults, then the selected board overlay, then component skills and builtin Lua resources. Board overlays affect SYSTEM only. Hidden board folders are excluded. DATA is /fatfs or the selected SD mount. Resolve writable roots through claw_paths or storage. Do not edit generated output.

## Lua module authoring

Use lua_driver_* for low-level peripherals and lua_module_* for higher-level modules. Each component requires CMakeLists.txt. Use skills/, test/, lib/ and src/ for their respective resources. Do not add flat root-level Lua scripts. Pure Lua components can use an empty idf_component_register(); C components list sources and includes.

The source API owners are lua_module_system/README.md, lua_module_lvgl/README.md and lua_module_ble/README.md under components/lua_modules/. Add a unique doc marker for each module README or public library. Update LUA_DOC_GROUPS in lua_sync_common.py when you assign a new module to an owner. Modules outside the map retain their local README and same-name library documents.

Document each argument, default, return, error, cleanup, hardware ownership, blocking and concurrency condition. Document only existing bindings. Hardware test scripts must release resources. C bindings must match their section and avoid dangling pointers.

The build extracts sections into the existing component_name.md and lib/name.md image paths. Library scripts keep lib/name.lua paths. Test scripts keep their relative paths in the generated builtin_lua_modules skill. Output paths must be globally unique. A missing or duplicate doc marker must fail the sync. The generated skill remains the module lookup index.

For document-only changes, check local references, language and section extraction. Use the documentation fixture tests under tests/host/python/. Do not run the removed upstream docs-site checks.

## Skill source and metadata contract


This document defines the standard `skills/` directory format, `SKILL.md` rules, metadata conventions, build sync rules, and filesystem path conventions for component-provided skills.

## Directory Layout

Any build component may provide a `skills/` directory:

```text
component_xx/
└── skills/
    └── skill_id/
        ├── SKILL.md
        ├── references/
        │   └── guide.md
        ├── scripts/
        │   └── action.lua
        └── assets/
            └── image.bin
```

Notes:

- `skills/<skill_id>/` is one complete skill.
- `SKILL.md` is the only required file.
- `references/`, `scripts/`, `assets/`, and other subdirectories are optional.
- The whole skill directory is packaged as one skill and copied unchanged into `skills/<skill_id>/` in the application SYSTEM file image.

## SKILL.md Rules

`SKILL.md` must start with JSON frontmatter:

```md
---
{
  "name": "skill_id",
  "description": "Short capability description.",
  "author": "bob",
  "metadata": {
    "cap_groups": ["cap_lua"],
    "manage_mode": "web",
    "category": ["utility", "ui"],
    "peripherals": [],
    "tags": ["weather", "forecast"]
  },
  "simulator": {
    "entry": "scripts/action.lua",
    "files": [
      "scripts/action.lua",
      "assets/icon.bin"
    ]
  }
}
---

# Skill Title
```

Rules:

- The frontmatter must be wrapped by `---`.
- The frontmatter must be valid JSON (a single JSON object).
- `SKILL.md` must contain exactly one H1 heading.
- `name` must be a non-empty string.
- `name` must exactly match the parent directory name `skills/<skill_id>`.
- `description` should briefly describe when to use the skill.
- `author` is optional, but if present it must be a non-empty string.
- If `author` contains angle brackets, it must use the form `Name <email>` with exactly one valid email address.
- `metadata` must be an object.
- `metadata.cap_groups` is optional. When present, it must be a JSON array of non-empty unique strings and declares the capability groups that need to be activated.
- `metadata.manage_mode` must be `readonly`, `web`, or `runtime`. Use `web` for ESP-Claw Skills Lab packaged skills. On device, `web` is treated the same as `readonly` for management (for example unregister rules). `runtime` is reserved for skills registered by the runtime.
- `metadata.category` must contain at least one value, and every value must be in the category allowlist.
- `metadata.category` value `ui` marks a Skill as browser-simulator capable. Web tools should only expose simulator entry points for Skills that explicitly include `ui`.
- `metadata.peripherals` may contain zero or more values, and every value must be in the peripheral allowlist.
- `metadata.tags` is optional.
- `metadata.tags`, when present, must be a string array.
- `metadata.tags` is free-form and is not validated against an allowlist.
- `metadata.tags` must not repeat any value already present in `metadata.category` or `metadata.peripherals`.
- If `metadata.category` contains `ui`, the frontmatter must include a `simulator` object.
- `simulator.entry` is the skill-relative Lua entry script used by the browser simulator, for example `scripts/action.lua`.
- `simulator.files` is the complete skill-relative file list that the browser simulator must download and mount before running the entry script. It must include `simulator.entry` and any required Lua libraries, assets, fonts, or data files.
- `simulator.entry` and `simulator.files` must not use absolute paths, `{CUR_SKILL_DIR}`, or `..`; paths are always relative to the skill directory.
- Additional keys at the root of the frontmatter or inside `metadata` may appear (for example tooling or Skills Lab fields). The device runtime ignores keys it does not read.

### Description

`description` affects skill matching, so it must describe user intent rather than implementation details.

Rules:

- Include common user wording when applicable, such as turn on/off, set color, brightness, LED strip/light.
- Include critical prerequisites when they affect whether the skill can be used.
- Keep it concise and avoid long paragraphs.
- Do not describe only internal script names, module names, or generic execution phrases.

Example:

```json
"description": "Turn the board LED strip/light on or off, set color or brightness. Requires board_hardware_info skill."
```

## Build Sync Rules

During build, `sync_component_skills.py` scans the `skills/` directory of every build component.

Sync rules:

- Every `skills/<skill_id>/SKILL.md` must exist.
- Every skill id must be unique across the whole project.
- Every file in the skill directory belongs to that skill.
- Every file in the skill directory is copied into `skills/<skill_id>/` in the SYSTEM FATFS image.
- `references/`, `scripts/`, `assets/`, and other subdirectories keep their relative paths.
- The build fails if two components provide the same `skills/<skill_id>/...` output path.
- Old component skill files recorded in the build manifest are removed from the output directory when they no longer exist.

Source example:

```text
component_xx/skills/light_switch/SKILL.md
component_xx/skills/light_switch/scripts/switch.lua
```

Copied output:

```text
skills/light_switch/SKILL.md
skills/light_switch/scripts/switch.lua
```

The `skills/...` paths above are relative paths inside the device SYSTEM filesystem image, not source-tree paths.

## `{CUR_SKILL_DIR}` Placeholder

When `SKILL.md` is loaded, the skill runtime replaces `{CUR_SKILL_DIR}` in the document body with the current skill filesystem directory.

Example:

```md
Run `{CUR_SKILL_DIR}/scripts/action.lua` with `lua_run_script`.
```

Rules:

- `{CUR_SKILL_DIR}` is expanded only in the `SKILL.md` body, not in JSON frontmatter.
- The expanded value points to the current skill directory in the device filesystem. Built-in skills usually expand under `/system/skills/<skill_id>`, while runtime-installed user skills expand under the DATA root's `skills/<skill_id>`.
- Use `{CUR_SKILL_DIR}/scripts/...` when passing a script path from this skill to a tool.

## Filesystem Path Rules

File tool paths (`read_file`, `write_file`, ...) must be absolute. When the model
reads files bundled with a skill, use the `{CUR_SKILL_DIR}` placeholder, which
expands to the skill's absolute directory:

- `read_file("{CUR_SKILL_DIR}/references/guide.md")`
- `read_file("{CUR_SKILL_DIR}/scripts/action.lua")`
- `read_file("{CUR_SKILL_DIR}/assets/name.ext")`

Do not pass relative paths, do not assume the source component directory name, and do not use `../` to move to a parent directory.

Path roots:

- Built-in/component skills are staged into the read-only SYSTEM root (`/system/skills/...`).
- Runtime-installed/user skills are stored under the writable DATA root (`<DATA>/skills/...`). DATA is `/fatfs` for flash storage, or the board-manager SD card mount point when SD storage is active.
- Skill documents should use `{CUR_SKILL_DIR}` for bundled references, scripts, and assets. Do not hard-code `/fatfs/skills/...` for skill-local files.
- Writable files created by Lua scripts should use `storage.get_root_dir()` and `storage.join_path(...)` instead of assuming `/fatfs`.

## Lua Skill Script Rules

If a skill contains Lua scripts, place them under `scripts/`:

```text
skills/<skill_id>/scripts/action.lua
```

Rules:

- Skill-local Lua scripts are read-only files distributed with the skill.
- User-facing actions should be implemented as standalone skills rather than `test/` entries.
- If script execution fails, the skill should require the model to report the error directly and avoid retrying with changed arguments.

## Naming And Conflict Rules

- Skill ids must be stable. Prefer lowercase letters, digits, underscores, or hyphens.
- Skill ids must exactly match their directory names.
- The project must not contain duplicate skill ids.
- The project must not contain duplicate skill output file paths.
- Do not expose the same user-facing action through multiple skills or script indexes.
