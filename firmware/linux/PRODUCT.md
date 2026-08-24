# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Child-app record scoped to `firmware/linux/`. Product-family context lives in the root `PRODUCT.md`; the visual source of truth is the root `DESIGN.md` (AIODI). This slice inherits both and adds only what is specific to the CM5 Linux shell.

## Users

The same desk-side user as the product family: personal developers and knowledge workers at a Mac keyboard who glance down at a portrait touch panel beside the keyboard. This slice additionally serves FradSer as a migration-evaluation artifact: proof that the Open DeskOS shell experience survives a port from ESP32-P4/LVGL to Orange Pi CM5 (RK3588S) + Linux/Electron before any hardware commitment is made.

## Product Purpose

First implementation slice of the "CM5 application chain" from `docs/open-deskos/CM5-S31-INTEGRATION.md`: render the Open DeskOS shell — status bar (connection bolt / centered page dots / bold clock), three-page horizontal pager (dashboard narrative stream, home widget grid, quota card), bottom inset peek strip placeholder, and fullscreen app view with guaranteed Back — inside a kiosk Electron window on the CM5's 568×1232 portrait touch panel. It validates shell interaction structure and AIODI token fidelity outside LVGL. The P4+C6 firmware remains production authority; this slice does not replace it.

## Positioning

Not an independent product: it is the Open DeskOS experience rendered on a second compute stack. Its binding fidelity duty — interaction anatomy and AIODI tokens must match the P4 launcher, enforced by tests rather than taste — is what a neighboring Electron dashboard could not truthfully copy: a grid-geometry port of `aiodi.grid_metrics()` plus BDD scenarios pinning parity with the P4 layout.

## Operating Context

- Target hardware: Orange Pi CM5 (RK3588S) driving a 568×1232 portrait touch panel; kiosk autostart via `scripts/cm5-install.sh` (run on-device, arm64).
- Development happens on macOS or Linux host: `./run.sh` windowed, `bash tests/smoke.sh`, `pnpm run e2e`.
- Touch input arrives through the display server (X11/Wayland evdev) straight to Chromium; Wayland sessions append `--ozone-platform-hint=auto`.
- Deployment is rsync-from-Mac then on-device install; see README runbook.
- Host smoke/e2e passing does NOT verify CM5 hardware behavior (GPU compositing, touch events, autostart remain unverified until first bring-up).

## Capabilities and Constraints

Confirmed capabilities:
- 568×1232 default kiosk window; `ODESK_SHELL_WIDTH`/`ODESK_SHELL_HEIGHT` overrides; `ODESK_SHELL_KIOSK=1` or `--kiosk`; `--smoke` headless size verification hooked on `did-finish-load`.
- Three-page horizontal touch pager with threshold-based swipe, visible page context (`名称 · N/3`), and status-bar dot sync: Dashboard narrative stream / Home widget grid / Quota honesty card.
- Home grid: 3 columns with declarative column/row spans in `src/renderer/config/desktop_layout.js`, mirroring `desktop_layout.lua` (clock and pomodoro 2-wide, pomodoro 2×2, year meter full-width); every tile exposes a truthful state label. All pages, tiles, status-bar indicators, peek content, and fullscreen app surfaces are self-contained plugins assembled by `core/composer.js`; extending the shell means adding a plugin file plus one config line (see `docs/AI_PLUGIN_GUIDE.md`), never core edits — enforced by smoke greps.
- Network and Mac bridge states are separate: the bolt reports network reachability, while quota and peek explicitly report `Mac bridge 未配置` and offer USB connection guidance.
- Tap any widget to open a fullscreen app view; Back and Escape always return to the exact page left.
- Runtime geometry: `layout.js` ports the firmware `aiodi.grid_metrics()` portrait algorithm (`fit = min(w/320, h/480)`) into CSS custom properties; the shell re-flows on any aspect ratio without cropping.
- Noto Sans SC Regular and Montserrat Bold are bundled locally under `src/renderer/fonts/` so CM5 rendering does not depend on host-installed fonts.

Hard constraints:
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, local files only, no remote content, no frameworks, no build step.
- Every color comes from root `DESIGN.md` tokens via `--odk-*` CSS variables; `tests/check_tokens.mjs` fails the build on drift against `../../DESIGN.md`. Off-palette hex literals are forbidden.
- Icons are Tabler Icons v3.46 outline SVGs inlined with `data-tabler` attributes; e2e enforces set completeness. (The P4 panel rasterizes FontAwesome glyphs — a platform-necessitated divergence, not a design one.)
- Connection and quota states display truthfully ("未连接"); placeholder data must never look real.

Deliberately undecided:
- Whether CM5 becomes a supported Open DeskOS line at all — this slice feeds the migration evaluation and commits to nothing.
- CM5 real-device validation (GPU, touch, autostart) is pending; do not treat host-green as device-green.

## Brand Commitments

calm / precise / companion — inherited unchanged from the product family. AIODI is law: black field, charcoal surfaces, outlined tiles, heavy numerals, scarce red/green/blue accents used only for state. Anti-references inherited: SaaS analytics dashboards, neon cyber/glassmorphism decoration, generic AI aesthetics, nested cards, side-stripe accents, decorative motion. No emojis in UI copy or code.

## Evidence on Hand

- `README.md` — slice scope, dev/deploy runbook, honest verification status.
- `AGENTS.md` — structure, style gates, commit conventions (`feat(linux): ...`).
- `src/renderer/fonts/{NotoSansSC-Regular.ttf,Montserrat-Bold.ttf}` — bundled AIODI type assets.
- Working shell: `src/renderer/{index.html,shell.css,shell.js,layout.js}` + `src/main.js`.
- Executable contracts: `tests/features/linux-shell.feature` (Chinese Gherkin), `tests/smoke.sh`, `tests/check_tokens.mjs`, `tests/layout-harness.mjs`, `tests/e2e.js`.
- Verified: host smoke (two resolutions + token parity) and e2e on macOS arm64. Absences future work must respect: no CM5 device verification yet; no fabricated usage/subscription data anywhere.

## Product Principles

1. **Parity over reinvention.** The shell mirrors the P4 launcher's anatomy — status bar, 3-column grid, pager, peek strip, Back escape. Divergence must be platform-necessitated, documented, and test-pinned.
2. **Tokens are law.** Color changes happen in root `DESIGN.md` and flow through the checker, never through ad-hoc hex values; the test is the contract, not the review eye.
3. **Honest instrument.** Show 未连接 and the empty peek strip truthfully; no decorative fake data, ever.
4. **Escape is guaranteed.** Back always works and restores the exact page the user left.
5. **Geometry adapts, never crops.** Runtime grid recomputation keeps every tile inside the viewport on any window ratio.

## Accessibility & Inclusion

Touch-first targets sized for fingers on a 568×1232 portrait panel. High-contrast AIODI primary/secondary text on black. Motion conveys state (page coast, dot progress), never decoration; navigation cues rely on shape and position (dots, layout), not color alone. No separate WCAG product mandate beyond readable type and strong contrast.
