# Repository Guidelines

## Project Structure & Module Organization

- `src/main.js` — Electron main process: window creation (default 568×1232),
  kiosk mode, env overrides (`ODESK_SHELL_WIDTH`, `ODESK_SHELL_HEIGHT`,
  `ODESK_SHELL_KIOSK` or `--kiosk`), and `--smoke` size verification.
  Also hardens the shell: single-instance lock, navigation/window-open/permission
  denial, renderer-crash exit, DevTools shortcut block in kiosk.
- `src/renderer/` — shell UI as plain DOM (`index.html` skeleton,
  `shell.css`, generated `uno.css`, and `shell.js` composition root). No frameworks.
- `src/renderer/core/` — plugin registry (`odkPlugins`), shared services
  (tick/connection, `odkServices`), desktop composer (`odkComposer`).
- `src/renderer/plugins/` — every visible element is one self-contained plugin
  (pages, grid tiles, status-bar indicators, peek content); placement lives in
  `src/renderer/config/desktop_layout.js`. Tiles are display-only surfaces
  (P4 parity: taps never open views). Adding a feature means a new plugin
  file plus one config line — never edit core; `tests/smoke.sh` greps enforce
  this. See `docs/AI_PLUGIN_GUIDE.md`.
- `tests/features/` — Chinese-Gherkin BDD scenarios (repo convention).
- `PRODUCT.md` — product context for the CM5 shell; `docs/AI_PLUGIN_GUIDE.md` defines the plugin contract.
- `tests/smoke.sh`, `tests/check_tokens.mjs` — executable checks.
- `scripts/start-kiosk.sh` — kiosk launcher used by autostart; restarts on exit
  and logs to `~/.local/state/open-deskos-shell/launcher.log`.
- `scripts/cm5-install.sh` — device-side installer (run on the CM5, arm64).
- `scripts/cm5-acceptance.sh` — device acceptance script emitting a JSON report;
  non-zero exit when any check fails.

## Build & Test Commands

```sh
pnpm install                 # installs the pinned Electron/UnoCSS toolchain
pnpm styles                  # generates src/renderer/uno.css
./run.sh                     # windowed dev run
bash tests/smoke.sh          # boots twice (default + overridden size), tokens, and contracts
pnpm run e2e                 # drives real scenarios: clock, swipe paging, tile/back
```

Smoke checks must pass before committing renderer changes. A host-passing run
does not verify CM5 hardware behavior; validate on device separately.

## Coding Style & Conventions

- 2-space indentation; UnoCSS CLI generates `src/renderer/uno.css` from renderer HTML/JS before the renderer starts.
- All colors come from the root `DESIGN.md` tokens via `--odk-*` CSS variables;
  `tests/check_tokens.mjs` fails on drift. UnoCSS utilities must reference these
  Open DeskOS variables rather than defining a second palette. Never hardcode
  off-palette hex values.
- Connection/quota states are shown honestly ("未连接"); never fabricate data placeholders that look real.
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`,
  local files only, no remote content.

## Commit & Pull Request Guidelines

- Use Conventional Commits with scope `linux`, e.g. `feat(linux): ...`.
- Add a `.feature` scenario first when changing shell behavior; keep scenarios
  and executable checks in sync. Before review, run `pnpm smoke` and the
  relevant `pnpm run e2e` checks; note that host validation does not cover CM5
  GPU, touch, or autostart behavior.
