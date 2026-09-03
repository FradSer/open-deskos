# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Active runtime record scoped to `runtime/linux/`. Product-family context lives in the root `PRODUCT.md`; the semantic visual tokens are in root `DESIGN.md`. This document adds only CM5/Linux runtime constraints.

## Users

Personal developers and knowledge workers using a fixed CM5 desk display. They glance at current status, then use direct touch, keyboard, or the accepted Remote Control to enter a focused view. A Mac is not an active-architecture dependency.

## Product Purpose

CM5 Desk Companion feasibility vertical slice: validate a trustworthy, local desk shell in a kiosk Electron window. Its primary proof is useful operation without a Mac or experimental hardware: current time, network state, focus status, explicitly configured OpenCode Go status, direct touch/keyboard navigation, and an optional Remote Bridge that never blocks use. Widget → focused built-in view continuation and its main-process intent seam remain validation infrastructure, not a claim of an installable app platform.

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
- Home grid: five columns by three rows on the widescreen CM5 display, with declarative column/row spans in `src/renderer/config/desktop_layout.js`; narrow windows reflow widgets into the responsive grid. Every visible Widget exposes a truthful state label and remains read-only; interactive controls live on dedicated App pages. All pages, Widgets, status-bar indicators, and built-in views are self-contained plugins assembled by `core/composer.js`; the intent seam validates main-process routing into the renderer runtime.
- Network, OpenCode Go, and Remote Link states are separate and always visible in the State Bar: the bolt reports network reachability, while the summary reports Linux-native, device-configured provider and Remote Link state.
- The State Bar is a larger glanceable orientation surface with Pi Sessions, provider, network, Remote Link, page position, and time. The shell has no dock or desktop icon pile; built-in view discovery and lifecycle validation live in the Built-in views surface.
- Pi Sessions combines local `ps` process discovery with `~/.pi/agent/directory-sessions` metadata. Processes without metadata remain visible with their PID, working directory, status, and elapsed runtime, while goals and modified files stay explicitly unavailable.
- Widget taps use `open-app` intent only for declared built-in views; `display-only` Widgets remain truthful and do not pretend to be launchers. Back and Escape always return to the exact source page and context.
- Runtime geometry: `layout.js` computes the Open DeskOS portrait grid algorithm (`fit = min(w/320, h/480)`) into CSS custom properties; the shell re-flows on any aspect ratio without cropping.
- Noto Sans SC Regular and Montserrat Bold are bundled locally under `src/renderer/fonts/` so CM5 rendering does not depend on host-installed fonts.

Hard constraints:
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, local files only, no remote content, no UI framework; UnoCSS CLI generates the static utility stylesheet before launch.
- Every color comes from root `DESIGN.md` tokens via `--odk-*` CSS variables; `tests/check_tokens.mjs` fails the build on drift against `../../DESIGN.md`. Off-palette hex literals are forbidden.
- Icons are Tabler Icons v3.46 outline SVGs inlined with `data-tabler` attributes; e2e enforces set completeness. (The P4 panel rasterizes FontAwesome glyphs — a platform-necessitated divergence, not a design one.)
- Connection and quota states display truthfully; placeholder data must never look real.
- Optional experiments may enrich a Widget but can never lock, hide, or make the core desk shell inert.

Deliberately undecided:
- Whether CM5 becomes a supported Open DeskOS line after hardware acceptance; this slice now owns active implementation but does not claim a shipping commitment.
- Which optional experiment—Face Agent/P4 camera, C6 gateway, or installable packages—earns a supported provider contract after its own acceptance gate.
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
4. **Core before experiment.** The shell remains usable without Face Agent, P4 camera, C6 gateway, Remote Bridge, or installable packages.
5. **Tokens are law.** Color changes happen in root `DESIGN.md` and flow through the checker, never through ad-hoc hex values; the test is the contract, not the review eye.
6. **Honest instrument.** Show unavailable and live state truthfully; no decorative fake data, ever.
7. **Escape is guaranteed.** Back always works and restores the exact page the user left.
8. **Geometry adapts, never crops.** Runtime grid recomputation keeps every Widget inside the viewport on any window ratio.

## Accessibility & Inclusion

Touch-first targets sized for fingers on the 1920×1280 HDMI display. High-contrast Open DeskOS primary/secondary text on black. Motion conveys state (page coast, dot progress), never decoration; navigation cues rely on shape and position (dots, layout), not color alone. No separate WCAG product mandate beyond readable type and strong contrast.
