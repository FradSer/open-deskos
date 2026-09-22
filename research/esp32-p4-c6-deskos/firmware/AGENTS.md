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
