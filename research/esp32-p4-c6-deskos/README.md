# Preserved P4+C6 research

This directory keeps the earlier ESP32-P4 UI/HID/audio host and ESP32-C6 Wi-Fi/ESP-NOW research. The active product is in [PRODUCT.md](../../PRODUCT.md) and the [Electron Shell](../../runtime/shell/README.md). This research does not set active product or release requirements.

## Read by task

| Task | Owner |
|---|---|
| Build firmware, run host checks, inspect protocol and safety limits | [Firmware README](firmware/README.md) |
| Run the desktop simulator and identify its limits | [Simulator README](firmware/sim/native_sdl/README.md) |
| Build or use the Apple USB client | [Apple README](apple/README.md) |
| Reproduce Guition display, touch and timing tests | [Hardware reference](reference/GUITION-JC4880P443.md) |
| Read Lua plugin, App, state and layout contracts | [Launcher API](firmware/components/lua_modules/lua_module_lvgl/README.md#lua-module-lvgl-lib-launcher) and module READMEs |
| Read the original machine-readable visual tokens | [AIODI tokens](docs/AIODI-DESIGN.md) |
| Inspect upstream versions and local changes | [UPSTREAM](firmware/UPSTREAM.md), component CHANGELOGs and vendor PROVENANCE files |

Old product plans, purchase estimates, task matrices and duplicate design guides are removed from the working tree. The owners above keep the protocol values, hardware constraints and reproduction steps. Historical measurements are limited to their recorded date. They do not prove current hardware acceptance.

Upstream API documents, skills, recovery defaults and agent guides are execution contracts. Keep their parameter, error and permission rules. Generated build output and staged simulator links are not separate documentation sources. Read source files instead.
