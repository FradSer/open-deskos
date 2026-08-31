# Repository Guidelines
## Commit Safety
Use git-agent for commits; never run raw `git add` or `git commit`. Use input or confirmation UI for needed clarification.
## Project Structure & Module Organization
- `runtime/linux/` is the active Electron CM5 runtime. Required peripherals are `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/`; `integrations/remote-bridge/` connects the Remote; `experiments/vision/face-agent/` is opt-in.
- `research/esp32-p4-c6-deskos/` preserves the prior P4+C6 device OS, simulator, docs, and Apple USB companion; it is not active product authority.
- Product authority is `PRODUCT.md`; runtime decisions are in `runtime/linux/CONTEXT.md` and `runtime/linux/docs/adr/`; semantic tokens are in `DESIGN.md`.
- Root only supplies UnoCSS. Install runtime dependencies in `runtime/linux/`. `runtime/linux/src/renderer/uno.css` is tracked generated CSS: regenerate with `pnpm styles`, never edit it. `@fradser/pi-kit` is unavailable; do not substitute an unverified package.
## Build, Test & Development Commands
```sh
cd runtime/linux && pnpm install && pnpm test && pnpm smoke && pnpm e2e
cd peripherals/esp32-s3-remote && eim run 'idf.py build' v6.0.1
cd peripherals/esp32-p4-camera && eim run 'idf.py build' v6.0.1
cmake -S research/esp32-p4-c6-deskos/firmware/tests/host -B build/host
cmake --build build/host -j && ctest --test-dir build/host --output-on-failure
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS -configuration Debug -destination 'platform=macOS' build
```
For preserved P4+C6 firmware, work from `research/esp32-p4-c6-deskos/firmware/application/open_deskos`: run `eim run "idf.py bmgr -c ./boards -b <board>" v6.0.1`, then build; keep Waveshare in `build-s3` and M5Paper in `build-m5paper`. The native simulator does not validate a target build. Use `research/esp32-p4-c6-deskos/firmware/tools/build_c6_espnow_slave.sh` for the preserved C6 bridge image.
## Coding Style, Testing & Reviews
Use 2-space JS/TS, standard Swift naming, and 4-space ESP-IDF C with `snake_case`. The CM5 runtime uses `DESIGN.md`; P4+C6 research retains AIODI builders. Start behavior work with the relevant Given/When/Then scenario; never commit credentials, diagnostics, or generated output. Use focused Conventional Commits (`fix(runtime):`, `refactor(integrations):`, `feat(peripherals):`); state scope and validation. The preserved P4+C6 tree has its own pre-commit workflow.
