# Repository Guidelines

## Project Structure & Module Organization

- `src/main.js` owns the Electron window, kiosk/smoke options, app-manager,
  OpenCode Go, Remote Bridge, and fixed-loopback Face Agent IPC; it denies
  navigation, popups, permissions, and kiosk DevTools.
- `src/renderer/` is a framework-free DOM shell. `core/` owns plugin lifecycle,
  composition, and the built-in-view intent seam; visible plugins live in
  `plugins/`, with placement in `config/desktop_layout.js`. Follow
  `docs/AI_PLUGIN_GUIDE.md`; do not bypass those seams.
- `tests/` contains mixed-language BDD features, Node contracts, smoke/layout
  checks, and Electron E2E. The adjacent architecture peripherals live at
  `../../peripherals/esp32-s3-remote/`, `../../peripherals/esp32-p4-camera/`,
  `../../integrations/remote-bridge/`, and
  `../../experiments/vision/face-agent/`; each has a scoped guide.
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh`, and
  `scripts/cm5-acceptance.sh` handle launch, CM5 installation, and acceptance.

## Build & Test Commands

```sh
pnpm install                 # installs the pinned Electron/UnoCSS toolchain
pnpm styles                  # regenerates the tracked src/renderer/uno.css artifact
pnpm test                    # Node unit and integration/contract tests
./run.sh                     # windowed dev run
bash tests/smoke.sh          # boots twice (default + overridden size), tokens, and contracts
pnpm run e2e                 # drives real scenarios: clock, swipe paging, tile/back
node --test ../../integrations/remote-bridge/test/*.test.js  # Remote Bridge protocol/service tests
```

Smoke checks must pass before renderer changes are reviewed. Host passes do not
verify CM5 GPU, touch, or autostart behavior; validate those on device.

## Coding Style & Conventions

- Use 2-space JavaScript. UnoCSS CLI regenerates the intentionally tracked
  `src/renderer/uno.css` from renderer HTML/JS before launch; never edit it by hand.
- All colors come from the root `DESIGN.md` tokens via `--odk-*` CSS variables;
  `tests/check_tokens.mjs` fails on drift. UnoCSS utilities must reference these
  Open DeskOS variables rather than defining a second palette. Never hardcode
  off-palette hex values.
- Connection, widget, and built-in-view states are shown honestly; never fabricate
  data placeholders that look real. Most persistent state belongs in the live
  peek, not tooltip-only chrome.
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`,
  local files only, no remote content.

## Commit & Pull Request Guidelines

- Use focused Conventional Commits; current history includes `fix(runtime):`.
- Start behavior changes with the relevant `.feature` scenario and keep checks
  in sync. Before review run `pnpm test`, `pnpm smoke`, plus affected E2E or
  Remote Bridge tests. State validation commands and unverified CM5 behavior.
