# Repository Guidelines

## Project Structure & Module Organization
- `src/main.js` owns Electron windowing, kiosk/smoke modes, IPC, OpenCode Go, Remote Bridge, and the UVC camera frame endpoint. It denies navigation, popups, permissions, and kiosk DevTools.
- `src/platform/` is the only place a host difference lives: state locations, logical endpoint naming, the Pi executable-name rule, and the process source. The Shell is otherwise host-neutral; CM5 is the reference host and 64-bit Windows is a supported one (@docs/WINDOWS_HOST.md).
- `native/odk-process/` is the optional Windows process reader (command line and working directory). It is built with `pnpm run build:native`, is optional at load time, and never blocks Shell start.
- `src/renderer/` is a framework-free DOM shell. `core/` owns composition, plugin lifecycle, and the built-in-view intent seam; `plugins/` own visible surfaces; `config/desktop_layout.js` is the placement authority. For built-in plugin contracts, use @docs/AI_PLUGIN_GUIDE.md; for installable package verification/lifecycle, use @docs/USER_APPLICATIONS.md.
- `tests/` contains Gherkin features (`tests/features/`), Node test contracts (`tests/*.test.js`), the cross-host acceptance script (`tests/smoke.mjs`, with `tests/smoke.sh` as its CM5 wrapper), and Electron E2E (`tests/e2e.js`).
- `tests/not-ported.js` owns the one way a suite states that a Windows Shell Host does not port what it exercises: `notPortedOnWindows(test, kind)` skips a whole file and `posixOnlyReason(kind)` skips one assertion. Both are keyed on the host, so the reference host runs everything; a new skip needs a reason there, never a silent conditional in the suite itself.
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh`, and `scripts/cm5-acceptance.sh` own launch, CM5 deployment, and on-device acceptance.
- For Widget/App implementation or renderer interaction changes, use @../../.agents/skills/open-deskos-widget/SKILL.md and only the references relevant to that task.
- For release work, use @README.md (controlled runtime updates) and `scripts/verify-release.sh`. A writable `ODESK_WORKSPACE` is distinct from the immutable active release; generated packages must pass system verification before installation.

## Build, Test & Development Commands
```sh
node --test tests/<affected>.test.js  # selected Node contracts
pnpm test                           # full Node contract suite
pnpm styles                         # regenerates tracked src/renderer/uno.css
pnpm smoke                          # single-size Electron boot check
node tests/smoke.mjs                # multi-size smoke, tokens, layout checks (no bash)
bash tests/smoke.sh                  # the same checks from the CM5 entry point
pnpm run build:native               # optional Windows process reader
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
- Host-run checks cannot execute a `win32` branch or build the Windows native reader. Platform behavior is pinned through injected host facts and captured process payloads; Windows acceptance is executed on a Windows host and reported separately.
- Release validation uses `pnpm preflight` on a candidate containing `release.json`; it is not a prerequisite for an unrelated local edit. Deployment and device acceptance follow `scripts/cm5-stage-release.sh` and `scripts/cm5-acceptance.sh`, not just host smoke output.
