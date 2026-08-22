# Repository Guidelines

## CRITICAL: Git Commits

NEVER use raw `git add`/`git commit` via Bash. When asked to commit, ALWAYS use git-agent.

## CRITICAL: Asking the User

ALWAYS interact with the user via user input prompts or confirmation UI when clarification is needed.

## Project Structure

- `firmware/open-deskos/` — ESP32-P4 设备固件（ESP-IDF，Guition JC4880P443C 板）
- `firmware/linux/` — CM5(RK3588S) Linux 设备外壳（Electron，与 P4 固件并行）
- `app/apple/` — macOS/iOS SwiftUI 客户端（Xcode 工程 + CLI target）
- `docs/open-deskos/` — 产品规格（`OPEN-DESKOS.md` 是顶层权威）
- `docs/reference/` — 现役板硬件参考资料

## Build & Test Commands

```sh
# Host tests (no ESP-IDF required)
cmake -S firmware/open-deskos/tests/host -B build/host
cmake --build build/host -j && ctest --test-dir build/host --output-on-failure

# Native SDL2 simulator (no ESP-IDF)
cd firmware/open-deskos/sim/native_sdl && ./run.sh

# Device build (IDF 6.0.1+ required for the P4 MIPI-DSI path)
cd firmware/open-deskos/application/open_deskos
eim run "idf.py bmgr -c ./boards -b jc4880p443c" v6.0.1
eim run "idf.py build" v6.0.1

# CM5 Linux shell (Electron)
cd firmware/linux && ./run.sh

# macOS CLI target (product name: odkctl)
xcodebuild -project app/apple/OpenDeskOS.xcodeproj -scheme OpenDeskOSCLI \
  -configuration Release -destination 'generic/platform=macOS' build
```

Host tests passing does not imply `idf.py build` passes — verify both independently.

## Core Principles

- BDD-driven TDD: ALWAYS start from BDD — define Given/When/Then scenarios in `.feature` files first
- Clean Architecture (4 layers, dependencies point inward only)
- Challenge the premise before implementing
- Choose the simplest implementation that fully meets current requirements
- Do not preserve backward compatibility
- Grow the system in layers
- Keep components modular with concerns clearly separated
- Prefer established, well-maintained libraries
- Make architectural decisions for the long term
- Web search selectively
- Verify your own work: run tests and typecheck after completing changes

## Code Quality

- No AI code slop (extra comments, unnecessary defensive checks, casts to `any`)
- Match surrounding style
- Never hardcode credentials
- Keep functions modular (~50 lines max)
- Clean up temporary files

## Testing

- Formal tests in `tests/`, `__tests__/`, or `spec/`
- Firmware BDD scenarios: `firmware/open-deskos/tests/features/*.feature`; macOS specs: `app/apple/tests/features/`
- Run quick validations with bash

## Style

- MUST NOT use emojis unless explicitly requested
- 2-space indentation for JS/TS; ESP-IDF C conventions for firmware (4-space, `snake_case`)
- Standard Swift naming for macOS client
- On-device UI follows the AIODI design system (`firmware/open-deskos/components/lua_modules/lua_module_lvgl/lib/aiodi.lua`); do not hand-roll off-palette colors

## Commit & Pull Request Guidelines

- Conventional Commits: `type(scope): summary`, e.g. `feat(firmware):`, `fix(firmware):`, `docs(firmware):` — scope matches the subtree under change
- Keep each commit scoped to one concern; deletion and reference repair belong together when one depends on the other
- No PR templates or CI config exist in this repo; commits are the review unit

## Firmware Subtree

`firmware/open-deskos/` 有自己的 `AGENTS.md`，在固件子树内工作时优先遵循。
