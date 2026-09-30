# Repository Guidelines

## Project Structure & Module Organization
- `src/main.js` owns Electron windowing, kiosk/smoke modes, IPC, OpenCode Go, Remote Bridge, and the UVC camera frame endpoint. It denies navigation, popups, permissions, and kiosk DevTools.
- `src/platform/` is the only place a host difference lives: state locations, logical endpoint naming, the Pi executable-name rule, and the process source. The Shell is otherwise host-neutral; CM5 is the reference host and 64-bit Windows is a supported one (@docs/WINDOWS_HOST.md).
- `native/odk-process/` is the optional Windows process reader (command line and working directory). It is built with `pnpm run build:native`, is optional at load time, and never blocks Shell start.
- `src/renderer/` is a framework-free DOM shell. `core/` owns composition, plugin lifecycle, grid-span placement (`core/grid-placement.js` decides a declared span from the cell the layout model produced, never from window width), and the built-in-view intent seam; `plugins/` own visible surfaces; `config/desktop_layout.js` is the placement authority. For built-in plugin contracts, use @docs/AI_PLUGIN_GUIDE.md; for installable package verification/lifecycle, use @docs/USER_APPLICATIONS.md.
- `tests/` contains Gherkin features (`tests/features/`), Node test contracts (`tests/*.test.js`), the cross-host acceptance script (`tests/smoke.mjs`, with `tests/smoke.sh` as its CM5 wrapper), and Electron E2E (`tests/e2e.js`).
- `tests/not-ported.js` owns the one way a suite states that a Windows Shell Host does not port what it exercises: `notPortedOnWindows(test, kind)` skips a whole file and `posixOnlyReason(kind)` skips one assertion. Both are keyed on the host, so the reference host runs everything; a new skip needs a reason there, never a silent conditional in the suite itself.
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh`, and `scripts/cm5-acceptance.sh` own launch, CM5 deployment, and on-device acceptance.
- For Widget/App implementation or renderer interaction changes, use @../../.agents/skills/open-deskos-widget/SKILL.md and only the references relevant to that task. It owns the state matrix, the type floors, and the tile-composition rules; this file does not restate them.
- For release work, use @README.md (controlled runtime updates) and `scripts/verify-release.sh`. A writable `ODESK_WORKSPACE` is distinct from the immutable active release; generated packages must pass system verification before installation.
- For driving a 64-bit Windows Shell Host from another machine — syncing a change, gating the deploy, and reading results back — use @docs/WINDOWS_HOST.md, which owns that procedure.

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
pnpm geometry                       # the geometry gates, as one command
```
Choose Node contracts for the changed subsystem; use the multi-size smoke script for layout/composition changes and E2E for renderer interactions. `pnpm geometry` is the entry point for anything that changes a Widget's composition, a page's placement, or a type ramp: it runs the responsive matrix (every reading drawable at both promised panel sizes), the density gate, and the per-Widget composition harnesses. A new geometry gate that is not wired into that runner is a report nobody runs.

Electron checks require a graphical session (headless setup is in @README.md) and regenerate CSS. Host tests do not verify CM5 GPU compositing, evdev touch, or graphical-session autostart.

### Writing an Electron harness
- A window that is not painting never runs `requestAnimationFrame`. Anything layout-critical must not wait for a frame — use a timer — and a screen capture needs the window shown (`showInactive()`) plus a settle before the shot.
- `app.exit(0)` does not stop the function: an `app.exit(1)` on the next line always wins. Write the failure exit as the other branch, or the gate reports a pass and exits as a failure.
- A harness that must also run on a Windows Shell Host takes its temporary directory from `os.tmpdir()` and never throws while cleaning up at exit — Windows still holds the profile lock, and an exception there surfaces as a dialog on the owner's desk.
- A test double must answer whatever the code under test measures: a Widget that reads the cell it was given needs `getBoundingClientRect` on the element the harness hands it.

## Coding Style & Naming Conventions
- 2-space JavaScript (CommonJS for main/preload/tests, ES modules for renderer).
- Never edit generated `src/renderer/uno.css`; regenerate it with `pnpm styles`.
- A Widget adapts to the cell it is drawn in, never to the window (@CONTEXT.md, @docs/adr/0028-a-widget-adapts-to-the-cell-it-is-drawn-in.md). A container-query type ramp needs an explicit floor, so a small cell yields larger type instead of sub-floor type; and a glanceable Widget re-composes rather than scrolling, stating the count of anything it drops.
- For visual changes, use @../../DESIGN.md and `--odk-*` semantic tokens. Its scoped `--pi-*` exception applies only to quoted Pi transcript content, not Shell controls or surfaces.
- Enforce renderer sandboxing (`contextIsolation: true`, `nodeIntegration: false`, local assets only).
- State representations must be truthful; never fabricate personal data.

## Verification Boundaries
- Live `./run.sh` uses configured services and user state; do not equate launching the Shell with an isolated fixture test.
- Host-run checks cannot execute a `win32` branch or build the Windows native reader. Platform behavior is pinned through injected host facts and captured process payloads; Windows acceptance is executed on a Windows host and reported separately.
- Release validation uses `pnpm preflight` on a candidate containing `release.json`; it is not a prerequisite for an unrelated local edit. Deployment and device acceptance follow `scripts/cm5-stage-release.sh` and `scripts/cm5-acceptance.sh`, not just host smoke output.

## Driving a Windows Shell Host
Connection, syncing, deploying, and reading results back from the 64-bit Windows host are one procedure, owned by @docs/WINDOWS_HOST.md. Three facts from it change how you work and are worth knowing before you start:
- An SSH session is Session 0, so it has no interactive desktop: anything that needs a window (Electron harnesses, screen captures, the kiosk) runs from an interactive scheduled task that you register from SSH, never from inside another task.
- A remote `.ps1` must be pure ASCII — PowerShell 5.1 parses a BOM-less UTF-8 file in the system code page, and a non-ASCII character turns into a syntax error. Do not build a PowerShell command line through ssh either: cmd eats the quotes and the pipes. Write the file, upload it, run it.
- A change is synced as a hash-gated deploy, not a copy: archive repo-root-relative paths, hand over an expected MD5 per file, and only trust `DEPLOY_OK`. Syncs never carry `.env.local` or any device state.
