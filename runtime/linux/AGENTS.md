# Repository Guidelines
## Project Structure & Module Organization
- `src/main.js` owns Electron windowing, kiosk/smoke modes, IPC, OpenCode Go, Remote Bridge, and fixed-loopback Face Agent status. It denies navigation, popups, permissions, and kiosk DevTools.
- `src/renderer/` is a framework-free DOM shell. `core/` owns composition, plugin lifecycle, and the built-in-view intent seam; `plugins/` own visible surfaces; `config/desktop_layout.js` is the placement authority. Do not bypass `docs/AI_PLUGIN_GUIDE.md`.
- `tests/` contains Gherkin features, Node contracts, smoke/layout checks, and Electron E2E. Related scopes are `../../peripherals/esp32-s3-remote/`, `../../peripherals/esp32-p4-camera/`, `../../integrations/remote-bridge/`, and `../../experiments/vision/face-agent/`.
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh`, and `scripts/cm5-acceptance.sh` own launch, CM5 deployment, and on-device acceptance.
## Build, Test & Development Commands
```sh
pnpm install
pnpm styles                 # regenerates tracked src/renderer/uno.css
pnpm test
./run.sh
bash tests/smoke.sh
pnpm run e2e
node --test ../../integrations/remote-bridge/test/*.test.js
```
Run smoke before reviewing renderer work. Host tests do not verify CM5 GPU compositing, evdev touch, or graphical-session autostart.
## Coding Style & Testing Guidelines
Use 2-space JavaScript. Never edit generated `src/renderer/uno.css`; regenerate it with `pnpm styles`. Use root `DESIGN.md` tokens through `--odk-*` variables; no off-palette hex literals. Keep renderer sandboxing (`contextIsolation`, no Node integration, local assets only). States must be truthful; do not fabricate personal data. Start behavior changes in the relevant `.feature`, then update the matching contract/E2E test.
## Commit & Pull Request Guidelines
Use focused Conventional Commits such as `fix(runtime):`. State the validation commands and any unverified CM5 hardware behavior. Do not commit credentials, logs, or diagnostic artifacts.
