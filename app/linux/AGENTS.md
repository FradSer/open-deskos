# Repository Guidelines

Scope: the Electron shell for the Orange Pi CM5 Linux panel in `app/linux/`.
Repository-wide rules live in the root `AGENTS.md`.

## Project Structure & Module Organization

- `src/main.js` — Electron main process: window creation (default 568×1232),
  kiosk mode, env overrides (`ODESK_SHELL_WIDTH`, `ODESK_SHELL_HEIGHT`,
  `ODESK_SHELL_KIOSK` or `--kiosk`), and `--smoke` size verification.
- `src/renderer/` — shell UI as plain DOM (`index.html`, `shell.css`,
  `shell.js`). No frameworks.
- `tests/features/` — Chinese-Gherkin BDD scenarios (repo convention).
- `tests/smoke.sh`, `tests/check_tokens.mjs` — executable checks.
- `scripts/cm5-install.sh` — device-side installer (run on the CM5, arm64).

## Build & Test Commands

```sh
pnpm install                 # or npm install; pins linux-arm64 Electron on device
./run.sh                     # windowed dev run
bash tests/smoke.sh          # boots twice (default + overridden size) and checks tokens
pnpm run e2e                 # drives real scenarios: clock, swipe paging, tile/back
```

Smoke checks must pass before committing renderer changes. A host-passing run
does not verify CM5 hardware behavior; validate on device separately.

## Coding Style & Conventions

- 2-space indentation; no build step for the renderer.
- All colors come from the root `DESIGN.md` tokens via `--odk-*` CSS variables;
  `tests/check_tokens.mjs` fails on drift. Never hardcode off-palette hex values.
- No emojis in UI copy or code. Connection/quota states are shown honestly
  ("未连接") — never fabricate data placeholders look real.
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`,
  local files only, no remote content.

## Commit & Pull Request Guidelines

- Conventional Commits with scope `linux`, e.g. `feat(linux): ...`.
- Add a `.feature` scenario first when changing shell behavior; keep scenarios
  and executable checks in sync.
