# Shell agent rules

## Structure

- `src/main.js` owns windows, kiosk/smoke, IPC and data endpoints. It denies navigation, popups, permissions and kiosk DevTools.
- `src/platform/` owns host state paths, endpoint names, Pi executable rules and process sources. Keep all other behavior shared. CM5 is the reference host; Windows x64 and macOS run the same Shell.
- `native/odk-process/` is the optional Windows process reader. Build it with `pnpm run build:native`. Build/load failure must never block startup.
- `src/renderer/` is a framework-free DOM Shell. `core/` owns composition, lifecycle and intent routing. Plugins own visible surfaces. `config/desktop_layout.js` owns placement.
- `core/grid-placement.js` uses the Cell from the layout model. It must not infer spans from window width.
- `tests/features/` holds scenarios. `tests/*.test.js` holds Node contracts. `tests/smoke.mjs` is the shared smoke entry; `tests/smoke.sh` wraps it for CM5. `tests/e2e.js` owns aggregate interaction checks.
- Declare Windows skips in `tests/not-ported.js`. Use `notPortedOnWindows(test, kind)` for a suite or `posixOnlyReason(kind)` for an assertion. Add a reason there; do not add silent host conditionals.
- `scripts/start-kiosk.sh`, `scripts/cm5-install.sh` and `scripts/cm5-acceptance.sh` own CM5 launch, deployment and device acceptance.

Read @docs/AI_PLUGIN_GUIDE.md for built-in contracts. Read @docs/USER_APPLICATIONS.md for installed package verification/lifecycle. For Widget/App or renderer changes, use @../../.agents/skills/open-deskos-widget/SKILL.md and only the relevant references.

Read @README.md for controlled releases and `scripts/verify-release.sh`. `ODESK_WORKSPACE` is writable; the active release is immutable. Generated packages must pass system verification before installation. Read @docs/WINDOWS_HOST.md before Windows connection, transfer, deployment or result collection.

## Verification

```sh
node --test tests/<affected>.test.js
pnpm test
pnpm styles
pnpm smoke
node tests/smoke.mjs
bash tests/smoke.sh
pnpm run build:native
pnpm e2e
pnpm geometry
```

Use affected Node contracts for subsystem changes. Use multi-size smoke for composition and E2E for interaction. Run `pnpm geometry` for Widget composition, page placement or type changes. It runs the responsive matrix, density and per-Widget harnesses. Wire new geometry gates into that runner.

Electron checks need a graphical test session and regenerate CSS. Headless setup is in @README.md. Host tests do not prove CM5 GPU presentation, evdev touch or graphical autostart. A macOS/Linux fixture cannot execute Windows branches or build the native reader; report Windows acceptance separately.

A candidate release needs `release.json` and `pnpm preflight`. Preflight is not required for an unrelated local edit. Deployment and acceptance use `scripts/cm5-stage-release.sh` and `scripts/cm5-acceptance.sh`. Live `./run.sh` reads configured services/user state; it is not an isolated fixture.

## Harness and code rules

- Use 2-space JavaScript. Main/preload/tests use CommonJS; renderer uses ES modules.
- Regenerate `src/renderer/uno.css` with `pnpm styles`. Do not edit it manually.
- A Widget adapts to its Cell. Keep explicit type floors. Re-compose before dropping complete items, state omitted counts and never scroll a glanceable Widget. See @docs/ARCHITECTURE.md#adr-0028.
- Use @../../DESIGN.md semantic `--odk-*` tokens. The scoped `--pi-*` exception applies only to quoted Pi content.
- Keep `contextIsolation:true`, `nodeIntegration:false` and local assets. Never fabricate personal data or availability.
- A nonpainting window does not run animation frames. Use timers for layout-critical work. Show a capture window with `showInactive()` and allow it to settle.
- `app.exit(0)` does not stop JavaScript execution. Put a failure exit in an exclusive branch.
- Use `os.tmpdir()` in host-neutral harnesses. Cleanup must not throw when Windows holds a profile lock.
- Test doubles must supply measured APIs. A Cell measurement requires `getBoundingClientRect`.

For Windows SSH, transfer, GUI tasks or capture, follow @docs/WINDOWS_HOST.md. Its Session 0, hash-check and private-state rules are mandatory.
