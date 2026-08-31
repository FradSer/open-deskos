# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Child-app record scoped to `firmware/linux/`. Product-family context lives in the root `PRODUCT.md`; the visual source of truth is the root `DESIGN.md` (Open DeskOS). This slice inherits both and adds only what is specific to the CM5 Linux shell.

## Users

The same desk-side user as the product family: personal developers and knowledge workers at a Mac keyboard who glance down at a portrait touch panel beside the keyboard. This slice additionally serves FradSer as a migration-evaluation artifact: proof that the Open DeskOS shell experience survives a port from ESP32-P4/LVGL to Orange Pi CM5 (RK3588S) + Linux/Electron before any hardware commitment is made.

## Product Purpose

Linux App Manager validation endpoint for the "CM5 application chain" from `docs/open-deskos/CM5-S31-INTEGRATION.md`: validate truthful state-first Widgets, an iOS-like peek for most persistent status, Widget → App continuation, a unified App Manager entry, and the Installer → App Manager → App Runtime intent seam inside a kiosk Electron window at the CM5's native 1920×1280 HDMI content size. The P4+C6 firmware remains production authority; this slice does not replace it.

## Positioning

Not an independent product: it is the Open DeskOS experience rendered on a second compute stack. Its binding fidelity duty — interaction anatomy and Open DeskOS tokens must remain coherent across the shell, enforced by tests rather than taste — is what a neighboring Electron dashboard could not truthfully copy: a responsive portrait grid model plus BDD scenarios pinning the layout contract.

## Operating Context

- Target hardware: Orange Pi CM5 (RK3588S) driving a 1920×1280 HDMI display; kiosk autostart via `scripts/cm5-install.sh` (run on-device, arm64).
- Development happens on macOS or Linux host: `./run.sh` windowed, `bash tests/smoke.sh`, `pnpm run e2e`.
- Touch input arrives through the display server (X11/Wayland evdev) straight to Chromium; Wayland sessions append `--ozone-platform-hint=auto`.
- Deployment is rsync-from-Mac then on-device install; see README runbook.
- Host smoke/e2e passing does NOT verify CM5 hardware behavior (GPU compositing, touch events, autostart remain unverified until first bring-up).

## Capabilities and Constraints

Confirmed capabilities:
- 1920×1280 default kiosk content size; `ODESK_SHELL_WIDTH`/`ODESK_SHELL_HEIGHT` overrides; `ODESK_SHELL_KIOSK=1` or `--kiosk`; `--smoke` headless size verification hooked on `did-finish-load`.
- Three-page horizontal touch pager with threshold-based swipe, visible page context (`名称 · N/3`), and status-bar dot sync: Dashboard narrative stream / Home state Widget grid / Quota honesty card.
- Home grid: 3 columns with declarative column/row spans in `src/renderer/config/desktop_layout.js`; every Widget exposes a truthful state label and may declare its continuation App. All pages, Widgets, status-bar indicators, peek content, and Apps are self-contained plugins assembled by `core/composer.js`; the App Platform seam handles Installer → App Manager → App Runtime intent routing.
- Network, Mac companion, and active App states are separate: the bolt reports network reachability, while dashboard, quota and peek check the Mac companion status server and peek also carries the current App live state.
- The status bar has one unified App Manager entry. The shell has no dock or desktop icon pile; App discovery and lifecycle validation live in the App Manager view.
- Widget taps use `open-app` intent only when an App is installed; `display-only` Widgets remain truthful and do not pretend to be launchers. Back and Escape always return to the exact source page and context.
- Runtime geometry: `layout.js` computes the Open DeskOS portrait grid algorithm (`fit = min(w/320, h/480)`) into CSS custom properties; the shell re-flows on any aspect ratio without cropping.
- Noto Sans SC Regular and Montserrat Bold are bundled locally under `src/renderer/fonts/` so CM5 rendering does not depend on host-installed fonts.

Hard constraints:
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, local files only, no remote content, no UI framework; UnoCSS CLI generates the static utility stylesheet before launch.
- Every color comes from root `DESIGN.md` tokens via `--odk-*` CSS variables; `tests/check_tokens.mjs` fails the build on drift against `../../DESIGN.md`. Off-palette hex literals are forbidden.
- Icons are Tabler Icons v3.46 outline SVGs inlined with `data-tabler` attributes; e2e enforces set completeness. (The P4 panel rasterizes FontAwesome glyphs — a platform-necessitated divergence, not a design one.)
- Connection and quota states display truthfully ("未连接"); placeholder data must never look real.

Deliberately undecided:
- Whether CM5 becomes a supported Open DeskOS line at all — this slice feeds the migration evaluation and commits to nothing.
- CM5 real-device validation (GPU, touch, autostart) remains a separate acceptance gate; do not treat host-green as device-green.

## Brand Commitments

calm / precise / companion — inherited unchanged from the product family. Open DeskOS uses a black field, charcoal surfaces, outlined tiles, heavy numerals, and scarce red/green/blue accents used only for state. Anti-references inherited: SaaS analytics dashboards, neon cyber/glassmorphism decoration, generic AI aesthetics, nested cards, side-stripe accents, decorative motion. No emojis in UI copy or code.

## Evidence on Hand

- `README.md` — slice scope, dev/deploy runbook, honest verification status.
- `AGENTS.md` — structure, style gates, commit conventions (`feat(linux): ...`).
- `src/renderer/fonts/{NotoSansSC-Regular.ttf,Montserrat-Bold.ttf}` — bundled Open DeskOS type assets.
- Working shell: `src/renderer/{index.html,shell.css,shell.js,layout.js}` + `src/main.js`.
- Executable contracts: `tests/features/linux-shell.feature` (Chinese Gherkin), `tests/smoke.sh`, `tests/check_tokens.mjs`, `tests/layout-harness.mjs`, `tests/e2e.js`.
- Verified: host smoke (two resolutions + token parity) and e2e on macOS arm64. Absences future work must respect: no CM5 device verification yet; no fabricated usage/subscription data anywhere.

## Product Principles

1. **Glance first, dive second.** Widgets state what is true; peek carries live status; Apps extend the Widget when a task needs more depth.
2. **Unified entry over icon piles.** App discovery and lifecycle validation belong in one searchable App Manager entry, not a dock or desktop icon grid.
3. **Intent over direct action.** UI emits intent; Installer, App Manager, and App Runtime own installation, authorization, lifecycle, and execution.
4. **Parity over reinvention.** The shell mirrors the P4 launcher's anatomy — status bar, 3-column grid, pager, peek strip, Back escape. Divergence must be platform-necessitated, documented, and test-pinned.
5. **Tokens are law.** Color changes happen in root `DESIGN.md` and flow through the checker, never through ad-hoc hex values; the test is the contract, not the review eye.
6. **Honest instrument.** Show 未连接, 未启动, and live App state truthfully; no decorative fake data, ever.
7. **Escape is guaranteed.** Back always works and restores the exact page the user left.
8. **Geometry adapts, never crops.** Runtime grid recomputation keeps every Widget inside the viewport on any window ratio.

## Accessibility & Inclusion

Touch-first targets sized for fingers on the 1920×1280 HDMI display. High-contrast Open DeskOS primary/secondary text on black. Motion conveys state (page coast, dot progress), never decoration; navigation cues rely on shape and position (dots, layout), not color alone. No separate WCAG product mandate beyond readable type and strong contrast.
