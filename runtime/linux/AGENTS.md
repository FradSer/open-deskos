# Repository Guidelines

## Project Structure & Module Organization
- `src/main.js` owns Electron windowing, kiosk/smoke modes, IPC, OpenCode Go, Remote Bridge, and fixed-loopback Face Agent status. It denies navigation, popups, permissions, and kiosk DevTools.
- `src/renderer/` is a framework-free DOM shell. `core/` owns composition, plugin lifecycle, and the built-in-view intent seam; `plugins/` own visible surfaces; `config/desktop_layout.js` is the placement authority. Follow `docs/AI_PLUGIN_GUIDE.md`.
- `tests/` contains Gherkin features (`tests/features/`), Node test contracts (`tests/*.test.js`), smoke/layout checks (`tests/smoke.sh`), and Electron E2E (`tests/e2e.js`).
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh`, and `scripts/cm5-acceptance.sh` own launch, CM5 deployment, and on-device acceptance.
- Package dependencies: Prefer internal `@fradser/pi-kit` workspace runtime when available (`dependencies` with `workspace:*`, never `peerDependencies`). `@fradser/pi-kit` is currently absent.

## Build, Test & Development Commands
```sh
pnpm install
pnpm styles                 # regenerates tracked src/renderer/uno.css
pnpm test                   # node --test tests/*.test.js
./run.sh
bash tests/smoke.sh
pnpm run e2e
```
Run smoke before reviewing renderer changes. Host tests do not verify CM5 GPU compositing, evdev touch, or graphical-session autostart.

## Coding Style & Naming Conventions
- 2-space JavaScript (CommonJS for main/preload/tests, ES modules for renderer).
- Never edit generated `src/renderer/uno.css`; regenerate it with `pnpm styles`.
- Use root `DESIGN.md` tokens through `--odk-*` CSS variables; no off-palette hex literals.
- Enforce renderer sandboxing (`contextIsolation: true`, `nodeIntegration: false`, local assets only).
- State representations must be truthful; never fabricate personal data.

## Testing Guidelines
- Start behavior changes with Given/When/Then scenarios in `tests/features/*.feature`.
- Update matching Node contracts in `tests/*.test.js` or E2E scenarios in `tests/e2e.js`.
- Run `pnpm test` and `pnpm smoke` to verify contracts before PRs.

## Commit & Pull Request Guidelines
- Use focused Conventional Commits such as `fix(cm5):` or `feat(cm5):`.
- State the validation commands run and explicitly note any unverified CM5 hardware behavior.
- Do not commit credentials, logs, or diagnostic artifacts.
