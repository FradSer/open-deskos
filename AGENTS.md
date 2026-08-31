# Repository Guidelines

## Commit Safety

Use git-agent for commits; never run raw `git add` or `git commit`. Use input or confirmation UI for needed clarification.

## Project Structure & Module Organization

- `firmware/open-deskos/` is ESP-IDF production firmware for the P4+C6, Waveshare S3, and M5Stack PaperColor boards, with shared components, a native SDL simulator, and host contracts.
- `firmware/linux/` is the plain-DOM Electron CM5 shell; `app/apple/` is the SwiftUI client and macOS CLI.
- Product authority is `docs/open-deskos/OPEN-DESKOS.md`; design tokens are in `DESIGN.md`.
- The root manifest supplies only UnoCSS. Install Linux and settings-UI dependencies in their directories. `firmware/linux/src/renderer/uno.css` is tracked generated CSS: regenerate with `pnpm styles`, never edit it.
- `@fradser/pi-kit` is unavailable. Do not substitute an unverified package; record the gap.

## Build, Test & Development Commands

```sh
# Host firmware tests
cmake -S firmware/open-deskos/tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure

# CM5 shell checks
cd firmware/linux && pnpm install && pnpm test && pnpm smoke && pnpm e2e

# Embedded settings UI
cd firmware/open-deskos/application/open_deskos/components/http_server/frontend_source
pnpm install && pnpm build && pnpm typecheck

# Apple management app
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOS \
  -configuration Debug -destination 'platform=macOS' build
```

For firmware, run these commands from `firmware/open-deskos/application/open_deskos`:

```sh
# Guition JC4880P443C (P4 + C6)
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1
eim run "idf.py -p PORT flash monitor" v6.0.1

# Waveshare ESP32-S3 Touch LCD 2.8
eim run "idf.py bmgr -c ./boards -b esp32_s3_touch_lcd_2_8" v6.0.1
eim run "idf.py -B build-s3 build" v6.0.1
eim run "idf.py -B build-s3 -p PORT flash monitor" v6.0.1

# M5Stack PaperColor (ESP32-S3 e-paper)
eim run "idf.py bmgr -c ./boards -b m5papercolor" v6.0.1
eim run "idf.py -B build-m5paper build" v6.0.1
eim run "idf.py -B build-m5paper -p PORT flash monitor" v6.0.1
```

Keep S3 in `build-s3`; the native simulator cannot replace a production ESP-IDF build. Run `firmware/open-deskos/tools/build_c6_espnow_slave.sh` from the repository root for the C6 bridge image.

## Coding Style & Testing Guidelines

Use 2-space JavaScript/TypeScript, standard Swift naming, and ESP-IDF C style with 4-space indentation and `snake_case`. Device UI must use AIODI tokens/builders. Start behavior changes with the relevant Given/When/Then scenario and keep executable checks alongside it. Never commit credentials, temporary diagnostics, or untracked generated output.

## Commit & Pull Request Guidelines

Use focused Conventional Commits; recent history includes `feat(firmware):`, `fix(firmware):`, `docs(firmware):`, `feat(app):`, and `test(app):`. Keep one concern per commit. There is no root PR template; firmware has `firmware/open-deskos/.github/workflows/pr_approved.yml` and `.pre-commit-config.yaml`. Describe the subsystem and validation run.
