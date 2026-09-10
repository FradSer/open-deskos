# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Active runtime record scoped to `runtime/linux/`. Product-family context lives in the root `PRODUCT.md`; the semantic visual tokens are in root `DESIGN.md`. This document adds only CM5/Linux runtime constraints.

## Users

Personal developers and knowledge workers using a fixed CM5 desk display. They glance at current status, then use direct touch, keyboard, or the accepted Remote Control to enter a focused view. A Mac is not an active-architecture dependency.

## Product Purpose

CM5 Desk Companion runtime: validate a trustworthy, local desk shell in a kiosk Electron window, including the supported local user-application lifecycle. Its primary proof is useful operation without a Mac or experimental hardware: current time, network state, focus status, explicitly configured OpenCode Go status, direct touch/keyboard navigation, optional Remote Bridge that never blocks use, and independently verified self-contained Widget/App packages. User packages are local and bounded; this is not a marketplace, native-extension, background-service, or network-permission platform.

## Positioning

The active implementation focus for Open DeskOS. It is not yet a committed supported product line: P4/C6 firmware, Face Agent, P4 camera, C6 gateway, and installable packages remain preserved experiments with separate acceptance decisions. The binding fidelity duty is a calm, truthful desk companion that remains useful when every optional integration is absent.

## Operating Context

- Target hardware: Orange Pi CM5 (RK3588S) driving a 1920×1280 HDMI display; kiosk autostart via `scripts/cm5-install.sh` (run on-device, arm64).
- Development happens on macOS or Linux host: `./run.sh` windowed, `bash tests/smoke.sh`, `pnpm run e2e`.
- Touch input arrives through the display server (X11/Wayland evdev) straight to Chromium; Wayland sessions append `--ozone-platform-hint=auto`.
- Deployment stages a CM5 runtime release then activates it through the device-owned update transaction; see README runbook.
- Host smoke/e2e passing does NOT verify CM5 hardware behavior (GPU compositing, touch events, autostart remain unverified until first bring-up).

## Capabilities and Constraints

Confirmed capabilities:
- 1920×1280 default kiosk content size; `ODESK_SHELL_WIDTH`/`ODESK_SHELL_HEIGHT` overrides; `ODESK_SHELL_KIOSK=1` or `--kiosk`; `--smoke` headless size verification hooked on `did-finish-load`.
- Four-page horizontal touch pager with threshold-based swipe, visible page context (`Today · N/4`), and State Bar dot sync: Today display summary / Home display-only Widget grid / Pi Sessions interactive App page / Usage interactive App page.
- Home grid: five columns by three rows on the widescreen CM5 display, with declarative column/row spans in `src/renderer/config/desktop_layout.js`; compact windows reflow widgets into readable square cells and scroll the Home page vertically. Every visible Widget exposes a truthful state label and remains read-only; interactive controls live on dedicated App pages. All pages, Widgets, status-bar indicators, and built-in views are self-contained plugins assembled by `core/composer.js`; the intent seam validates main-process routing into the renderer runtime.
- The State Bar uses a bolt-only network reachability indicator; OpenCode Go and Remote Link states remain available in their dedicated surfaces without duplicating status text in the bar.
- The State Bar is a larger glanceable orientation surface with Pi Sessions, network reachability, page position, and time. The shell has no dock or desktop icon pile; built-in view discovery and lifecycle validation live in the Built-in views surface.
- Pi Sessions combines local `ps` process discovery with `~/.pi/agent/directory-sessions` metadata. Processes without metadata remain visible with their PID, working directory, status, and elapsed runtime, while goals and modified files stay explicitly unavailable.
- Widget taps use `open-app` intent only for declared built-in views; `display-only` Widgets remain truthful and do not pretend to be launchers. The Your apps page manages separately installed local user Widgets/Apps through the application lifecycle service. Back and Escape always return to the exact source page and context.
- Runtime geometry: `layout.js` keeps the desktop grid inside the panel and computes compact columns from a 200px cell floor, with CSS custom properties as the geometry contract. Compact Home supports touch, wheel, and Up/Down keyboard scrolling; App interiors use the available width within page margins.
- Noto Sans SC Regular and Montserrat Bold are bundled locally under `src/renderer/fonts/` so CM5 rendering does not depend on host-installed fonts.

Hard constraints:
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, local files only, no remote content, no UI framework; UnoCSS CLI generates the static utility stylesheet before launch.
- Every color comes from root `DESIGN.md` tokens via `--odk-*` CSS variables; `tests/check_tokens.mjs` fails the build on drift against `../../DESIGN.md`. Off-palette hex literals are forbidden.
- Icons are Tabler Icons v3.46 outline SVGs inlined with `data-tabler` attributes; e2e enforces set completeness. (The P4 panel rasterizes FontAwesome glyphs — a platform-necessitated divergence, not a design one.)
- Connection and quota states display truthfully; placeholder data must never look real.
- Optional experiments may enrich a Widget but can never lock, hide, or make the core desk shell inert.

Deliberately undecided:
- Whether CM5 becomes a supported Open DeskOS line after hardware acceptance; this runtime owns active implementation but does not claim hardware deployment or a shipping commitment.
- Which optional experiment—Face Agent/P4 camera or C6 gateway—earns a supported provider contract after its own acceptance gate. The local user-application lifecycle is implemented and supported within its package limits; it does not imply marketplace, native, background, or network capabilities.
- CM5 real-device validation (GPU, touch, autostart) remains a separate acceptance gate; do not treat host-green as device-green.

## Brand Commitments

calm / precise / companion — inherited unchanged from the product family. Open DeskOS uses a black field, charcoal surfaces, outlined tiles, heavy numerals, and scarce red/green/blue accents used only for state. Anti-references inherited: SaaS analytics dashboards, neon cyber/glassmorphism decoration, generic AI aesthetics, nested cards, side-stripe accents, decorative motion. No emojis in UI copy or code.

## Evidence on Hand

- `README.md` — slice scope, dev/deploy runbook, controlled release update, and honest verification status.
- `AGENTS.md` — structure, style gates, commit conventions (`feat(linux): ...`).
- `src/renderer/fonts/{NotoSansSC-Regular.ttf,Montserrat-Bold.ttf}` — bundled Open DeskOS type assets.
- Working shell: `src/renderer/{index.html,shell.css,shell.js,layout.js}` + `src/main.js`.
- Executable contracts: `tests/features/linux-shell.feature` (Chinese Gherkin), `tests/smoke.sh`, `tests/check_tokens.mjs`, `tests/layout-harness.mjs`, `tests/e2e.js`.
- Verified: host smoke (two resolutions + token parity) and e2e on macOS arm64. Absences future work must respect: no CM5 device verification yet; no fabricated usage/subscription data anywhere.

## Product Principles

1. **Glance first, dive second.** The State Bar, Today, and Widgets state what is true; focused built-in views add depth only when needed.
2. **Unified entry over icon piles.** Built-in view discovery and lifecycle-seam validation belong in one searchable entry, not a dock or desktop icon grid.
3. **Intent over direct action.** UI emits intent; the main-process endpoint and renderer runtime own the current built-in-view lifecycle seam.
4. **Core before experiment.** The shell remains usable without Face Agent, P4 camera, C6 gateway, or Remote Bridge; local user packages are optional and independently managed.
5. **Tokens are law.** Color changes happen in root `DESIGN.md` and flow through the checker, never through ad-hoc hex values; the test is the contract, not the review eye.
6. **Honest instrument.** Show unavailable and live state truthfully; no decorative fake data, ever.
7. **Escape is guaranteed.** Back always works and restores the exact page the user left.
8. **Geometry adapts, never crops.** Runtime grid recomputation keeps the desktop footprint stable and compact Widgets horizontally contained. Vertical scrolling preserves readable content instead of shrinking an entire compact grid into the viewport.
9. **User applications are isolated.** Installed packages are self-contained HTML served in opaque, sandboxed frames and activated only after verifier acceptance; built-in plugins remain trusted static runtime code.

## Accessibility & Inclusion

Touch-first targets sized for fingers on the 1920×1280 HDMI display. High-contrast Open DeskOS primary/secondary text on black. Motion conveys state (page coast, dot progress), never decoration; navigation cues rely on shape and position (dots, layout), not color alone. No separate WCAG product mandate beyond readable type and strong contrast.
