# Repository Guidelines
## Project Structure & Module Organization
This is preserved ESP32-P4+C6 DeskOS research firmware, not the active CM5 runtime. `application/open_deskos/` contains Guition P4+C6, Waveshare S3, and M5Stack PaperColor board-manager targets. `components/claw_*` provides the ESP-Claw base; `components/odk_*` contains historical platform services; `components/lua_modules/` contains Lua and hardware bindings; `sim/native_sdl/` is the desktop Lua/LVGL simulator; host contracts and BDD are in `tests/host/` and `tests/features/`.
## Build, Test & Development Commands
Use ESP-IDF 6.0.1 through `eim`:
```sh
cd application/open_deskos
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1 && eim run "idf.py build" v6.0.1
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1 && eim run "idf.py -B build-s3 build" v6.0.1
cmake -S tests/host -B /tmp/open-deskos-host-build && cmake --build /tmp/open-deskos-host-build -j && ctest --test-dir /tmp/open-deskos-host-build --output-on-failure
```
Use `build-m5paper` for PaperColor. The simulator does not validate target display paths. For the historical settings frontend, run `pnpm build && pnpm typecheck` from `application/open_deskos/components/http_server/frontend_source`.
## Coding Style & Testing Guidelines
Use 4-space ESP-IDF C, `snake_case`, opaque handles, explicit `esp_err_t` ownership, and small public headers. Keep board assumptions in board metadata/setup, not generic components. Preserve `/system` read-only and DATA-root conventions; edit source FATFS trees, never staged output. Add/update `tests/features/*.feature` before behavior changes; then run relevant board builds and host CTest. Do not edit board-manager code, managed components, SDK config output, or staged FATFS artifacts manually.
## Commit & Pull Request Guidelines
Use focused Conventional Commits, identify the research board/build target, and report tests plus unverified hardware. Follow this subtree’s `.pre-commit-config.yaml`; never commit credentials or diagnostics.
