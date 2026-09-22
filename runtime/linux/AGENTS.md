# Repository Guidelines

## Project Structure & Module Organization
- `src/main.js` owns Electron windowing, kiosk/smoke modes, IPC, OpenCode Go, Remote Bridge, and the UVC camera frame endpoint. It denies navigation, popups, permissions, and kiosk DevTools.
- `src/renderer/` is a framework-free DOM shell. `core/` owns composition, plugin lifecycle, and the built-in-view intent seam; `plugins/` own visible surfaces; `config/desktop_layout.js` is the placement authority. For built-in plugin contracts, use @docs/AI_PLUGIN_GUIDE.md; for installable package verification/lifecycle, use @docs/USER_APPLICATIONS.md.
- `tests/` contains Gherkin features (`tests/features/`), Node test contracts (`tests/*.test.js`), smoke/layout checks (`tests/smoke.sh`), and Electron E2E (`tests/e2e.js`).
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh`, and `scripts/cm5-acceptance.sh` own launch, CM5 deployment, and on-device acceptance.
- For Widget/App implementation or renderer interaction changes, use @../../.agents/skills/open-deskos-widget/SKILL.md and only the references relevant to that task.
- For release work, use @README.md (controlled runtime updates) and `scripts/verify-release.sh`. A writable `ODESK_WORKSPACE` is distinct from the immutable active release; generated packages must pass system verification before installation.

## Build, Test & Development Commands
```sh
node --test tests/<affected>.test.js  # selected Node contracts
pnpm test                           # full Node contract suite
pnpm styles                         # regenerates tracked src/renderer/uno.css
pnpm smoke                          # single-size Electron boot check
bash tests/smoke.sh                  # multi-size smoke, tokens, layout checks
pnpm e2e                            # renderer interaction/style regressions
```
Choose Node contracts for the changed subsystem; use the multi-size smoke script for layout/composition changes and E2E for renderer interactions. Electron checks require a graphical session (headless setup is in @README.md) and regenerate CSS. Host tests do not verify CM5 GPU compositing, evdev touch, or graphical-session autostart.

## Coding Style & Naming Conventions
- 2-space JavaScript (CommonJS for main/preload/tests, ES modules for renderer).
- Never edit generated `src/renderer/uno.css`; regenerate it with `pnpm styles`.
- For visual changes, use @../../DESIGN.md and `--odk-*` semantic tokens. Its scoped `--pi-*` exception applies only to quoted Pi transcript content, not Shell controls or surfaces.
- Enforce renderer sandboxing (`contextIsolation: true`, `nodeIntegration: false`, local assets only).
- State representations must be truthful; never fabricate personal data.

## Verification Boundaries
- Live `./run.sh` uses configured services and user state; do not equate launching the Shell with an isolated fixture test.
- Release validation uses `pnpm preflight` on a candidate containing `release.json`; it is not a prerequisite for an unrelated local edit. Deployment and device acceptance follow `scripts/cm5-stage-release.sh` and `scripts/cm5-acceptance.sh`, not just host smoke output.
