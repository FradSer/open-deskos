# Repository Guidelines

## Commit Safety

Use git-agent for commits; never run raw `git add` or `git commit`. Use input or confirmation UI for needed clarification.

## Project Structure & Module Organization

- `runtime/linux/` is the active plain-DOM Electron CM5 runtime. Its required architecture peripherals are `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/`; `integrations/remote-bridge/` connects the Remote and `experiments/vision/face-agent/` is opt-in.
- `research/esp32-p4-c6-deskos/` preserves the earlier parallel P4+C6 device OS, including its ESP-IDF firmware, simulator, documentation, and Apple USB companion. It is not active product authority.
- Product authority is `PRODUCT.md`; runtime vocabulary and decisions are in `runtime/linux/CONTEXT.md` and `runtime/linux/docs/adr/`. Semantic design tokens are in `DESIGN.md`.
- The root manifest supplies only UnoCSS. Install runtime dependencies in `runtime/linux/`. `runtime/linux/src/renderer/uno.css` is tracked generated CSS: regenerate with `pnpm styles`, never edit it.
- `@fradser/pi-kit` is unavailable. Do not substitute an unverified package; record the gap.

## Build, Test & Development Commands

```sh
# Active CM5 runtime
cd runtime/linux && pnpm install && pnpm test && pnpm smoke && pnpm e2e

# Required peripherals
cd peripherals/esp32-s3-remote && eim run 'idf.py build' v6.0.1
cd peripherals/esp32-p4-camera && eim run 'idf.py build' v6.0.1

# Preserved P4+C6 research host tests
cmake -S research/esp32-p4-c6-deskos/firmware/tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure

# Preserved Apple P4 companion
xcodebuild -project research/esp32-p4-c6-deskos/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS \
  -configuration Debug -destination 'platform=macOS' build
```

For preserved P4+C6 research firmware, run commands from `research/esp32-p4-c6-deskos/firmware/application/open_deskos`:

```sh
# Guition JC4880P443C (P4 + C6)
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1

# M5Stack PaperColor (ESP32-S3 e-paper)
eim run "idf.py bmgr -c ./boards -b m5papercolor" v6.0.1
eim run "idf.py -B build-m5paper build" v6.0.1
```

Keep S3 in `build-s3`; the native simulator cannot replace a research target build. Run `research/esp32-p4-c6-deskos/firmware/tools/build_c6_espnow_slave.sh` from the repository root for the preserved C6 bridge image.

## Coding Style & Testing Guidelines

Use 2-space JavaScript/TypeScript, standard Swift naming, and ESP-IDF C style with 4-space indentation and `snake_case`. Device UI must use AIODI tokens/builders. Start behavior changes with the relevant Given/When/Then scenario and keep executable checks alongside it. Never commit credentials, temporary diagnostics, or untracked generated output.

## Commit & Pull Request Guidelines

Use focused Conventional Commits and keep one concern per commit. State the active runtime, peripheral, experiment, or research scope plus validation run. The preserved P4+C6 tree retains its own workflow and pre-commit configuration under `research/esp32-p4-c6-deskos/firmware/`.
