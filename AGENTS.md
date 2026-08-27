# Repository Guidelines

## CRITICAL: Git Commits

NEVER use raw `git add`/`git commit` via Bash. When asked to commit, ALWAYS use git-agent.

## CRITICAL: Asking the User

ALWAYS interact with the user via user input prompts or confirmation UI when clarification is needed.

## Project Structure & Module Organization

- `firmware/open-deskos/` contains the ESP-IDF firmware: `application/open_deskos/`, shared `components/`, Guition JC4880P443C and Waveshare ESP32-S3 board definitions, the native SDL simulator, and host contracts under `tests/`.
- `firmware/linux/` is the plain-DOM Electron shell for the CM5 panel.
- `app/apple/` is the SwiftUI client plus the macOS CLI target.
- Product authority is `docs/open-deskos/OPEN-DESKOS.md`; AIODI tokens live in `DESIGN.md`.
- The root `package.json` only supplies UnoCSS tooling. Linux and the embedded settings UI have separate manifests/lockfiles; install in the directory being changed.
- `@fradser/pi-kit` is absent. Do not add a replacement or unverified registry dependency; record the gap if needed.

## Build, Test & Development Commands

```sh
# Host firmware tests
cmake -S firmware/open-deskos/tests/host -B build/host
cmake --build build/host -j
ctest --test-dir build/host --output-on-failure

# CM5 shell checks
cd firmware/linux && pnpm install && pnpm smoke && pnpm e2e

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
```

Keep S3 in `build-s3`; the native simulator cannot replace a production ESP-IDF build. Run `firmware/open-deskos/tools/build_c6_espnow_slave.sh` from the repository root for the C6 bridge image.

## Coding Style & Testing Guidelines

Use 2-space JavaScript/TypeScript, standard Swift naming, and ESP-IDF C style with 4-space indentation and `snake_case`. Device UI colors/layout must use AIODI tokens/builders. Add or update a Given/When/Then scenario in the relevant `tests/features/` directory before behavior changes; keep executable checks beside scenarios. Never commit credentials, generated output, or temporary diagnostics.

## Commit & Pull Request Guidelines

Use focused Conventional Commits, including recent `feat(firmware):`, `fix(firmware):`, `docs(firmware):`, `feat(app):`, and `test(app):` prefixes. Keep one concern per commit. No root-level PR template/workflow exists; firmware has `.github/workflows/pr_approved.yml` and `.pre-commit-config.yaml`. Describe the subsystem and validation commands. Use git-agent for commits.
