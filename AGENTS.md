# Repository Guidelines

## Project Structure & Module Organization
- `runtime/linux/` is the active Electron CM5 (RK3588S) runtime. Required peripherals are `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/`; `integrations/remote-bridge/` connects the Remote; `experiments/vision/face-agent/` is opt-in.
- `research/esp32-p4-c6-deskos/` preserves the prior P4+C6 device OS, simulator, docs, and Apple USB companion; it is not active product authority.
- Product authority is `PRODUCT.md`; runtime decisions are in `runtime/linux/CONTEXT.md` and `runtime/linux/docs/adr/`; semantic tokens are in `DESIGN.md`.
- Root only supplies UnoCSS. Install runtime dependencies in `runtime/linux/`. `runtime/linux/src/renderer/uno.css` is tracked generated CSS: regenerate with `pnpm styles`, never edit it directly.
- Package dependencies: Prefer the internal `@fradser/pi-kit` workspace runtime for shared reusable helpers when available (`"@fradser/pi-kit": "workspace:*"` under `dependencies`, never `peerDependencies`). `@fradser/pi-kit` is currently unavailable; do not substitute an unverified package.

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

## Coding Style & Naming Conventions
- JavaScript/TypeScript: 2-space indentation. Semantic tokens must use `DESIGN.md` variables (`--odk-*`).
- ESP-IDF C: 4-space indentation, `snake_case`, bounded buffers, and explicit error handling.
- Swift: Standard Apple/Swift naming conventions.

## Testing Guidelines
- BDD-driven TDD: Start behavior work with Given/When/Then scenarios in `.feature` files before writing code or unit tests.
- Verify changes with scoped test commands (Node test runner, CTest, or xcodebuild).
- Never commit credentials, tokens, diagnostic dumps, or temporary build outputs.

## Commit & Pull Request Guidelines
- Use `git-agent commit` or the `/git:commit` skill for commits; never run raw `git add` or `git commit`.
- Use focused Conventional Commits (`fix(cm5):`, `feat(hw):`, `refactor(link):`, `feat(vision):`, `fix(p4):`, `refactor(mac):`). State validation commands and scope in commit messages.
