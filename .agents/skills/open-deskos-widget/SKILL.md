---
name: open-deskos-widget
description: >-
  Develop, style, verify, and deploy Open DeskOS CM5 widgets and visual plugins on the Linux Electron runtime.
  Use when creating or refactoring widgets, tuning layout density and typography, isolating plugin faults,
  managing git-agent shared worktrees, or staging releases on the CM5 hardware.
metadata:
  short-description: Open DeskOS CM5 widget engineering, layout density, and deployment workflow
---

# Open DeskOS CM5 Widget Engineering & Operational Workflow

This skill documents the engineering patterns, architectural contracts, design principles, testing harnesses, git protocols, and CM5 deployment procedures established during Open DeskOS runtime development.

## 1. Architectural Contracts & Plugin Lifecycle

Widgets in Open DeskOS are glanceable, read-only instruments. They live under `runtime/linux/src/renderer/plugins/` and mount declaratively via `config/desktop_layout.js`.

### Plugin Declaration Contract

```javascript
;(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.tile.example',          // Controlled odk. namespace; auto-classes element as .w-example
    manifest: { schemaVersion: 1 },  // Mandatory manifest version
    kind: 'tile',                    // 'tile' | 'page' | 'status' | 'app'
    app: 'Example',                  // English diagnostic name
    state: 'Live',                   // Default truthful state
    interaction: 'display-only',     // Mandatory for tiles; tiles never declare app continuations
    mount(el, ctx) {
      el.innerHTML = `...`
      ctx.onTick((now) => { /* 1-second tick callback; never create private setInterval */ })
    },
    unmount(el, ctx) {
      /* Optional cleanup; scopedContext automatically tears down onTick subscriptions */
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
```

### Critical Rules

- **Display-only**: Tiles never expose direct app continuations or interactive clicks; interactive controls belong on dedicated App pages.
- **Seam integrity**: Never make raw network calls or disk reads from plugins. External data flows through main process background sources and is exposed over narrow preload IPC channels (`window.odkPlatform.*`).
- **Truthful states**: Never fabricate placeholder telemetry. Unconnected, waiting, or stale states must be explicitly stated.

---

## 2. Integration and Deployment Boundaries

### External data sources

- Treat third-party APIs as untrusted, slow, and schema-changing. Read the source/API skill documentation before calling an endpoint; validate the real response shape with a minimal request before designing the widget.
- Keep API keys in a device-local `EnvironmentFile` or ignored `.env.local`; never copy secrets into a release, source file, screenshot, log, or commit. Confirm the service user can read the file and inspect the running process environment when debugging authentication.
- Separate data freshness from presentation rotation: cache a bounded, versioned dataset in the main process user-data directory, refresh it on an explicit interval, and choose the next item from the cache without calling the network on every tick. Add deterministic tests for cache load/save, corrupt-cache recovery, filtering, random selection, no-immediate-repeat, and cooldown by source/book.
- Download remote images in the main process, validate content type and size, and pass a bounded data URL or local safe asset to the renderer. If using `data:` images, update the renderer CSP explicitly (`img-src ... data:`) and test the actual Electron renderer rather than relying on curl.

### Immutable release discipline

- The active release is sealed and must never be edited in place. Do not live-patch `/opt/open-deskos/releases/*`; it creates a release that cannot be reproduced and can leave `main.js`, dependencies, generated assets, and tests from different revisions.
- Before deployment, verify the target checkout is coherent (`main.js` imports exist, renderer scripts and plugin registrations agree, generated CSS is current). Stage one complete release through `cm5-stage-release.sh` and let device preflight decide activation.
- If preflight fails, stop and report the exact blocker. Do not bypass validation or manually copy selected files into the active release. Fix the source or the device preflight environment, then redeploy atomically. A screenshot of a manually patched process is not deployment evidence.
- After activation, verify `readlink -f /opt/open-deskos/current`, the kiosk service PID/app path, service environment, and release metadata. Confirm the running process loaded the active release before trusting any behavioral claim about it.
- Keep deployment diagnostics separate from product behavior. Existing unrelated preflight failures, missing display servers, dependency-store corruption, or service configuration errors must not be “fixed” by changing widget code.

## 3. Fault Isolation & Hardening (System Resilience)

A single broken widget must never crash or block the Open DeskOS shell.

### Three Load-Bearing Hardening Seams

1. **Mount & Unmount Containment (`core/registry.js`)**:
   `activate` must catch mount exceptions, clean any partial DOM (`el?.replaceChildren?.()`), log the failure to `console.error`, and mark `container.dataset.state = 'Error'` with a fallback `.widget-error` label. It returns `false` instead of re-throwing into `composer.build`.
2. **Shared Tick Isolation (`core/services.js`)**:
   `notify(subs, arg)` and the initial subscription callback in `onTick` must wrap each subscriber invocation in `try / catch`. One throwing widget callback must not starve subsequent widgets or spam uncaught errors each second.
3. **Operational Bypass (`ODESK_DISABLED_PLUGINS`)**:
   Operators can exclude problematic plugins at startup without blocking the shell:
   ```bash
   ODESK_DISABLED_PLUGINS="odk.tile.broken odk.page.faulty" ./run.sh --kiosk
   ```
   - Passed to renderer via URL query `?disabledPlugins=`.
   - `core/composer.js` filters the layout via `filterLayout(layout, disabled)` before validation and rendering.
   - Disabled tiles are omitted, status slots stay empty, and disabled pages are pruned from pagination (dots adjust automatically).

---

## 4. Layout Geometry & Dynamic Grid Math

### Dynamic Compact Row Calculation (`layout.js`)

In narrow or compact development windows (<1000px width), tiles collapse into auto-placed 1x1 cells. The compact row count must **never** be hardcoded:

```javascript
function gridWidgetCount(layout) {
  const grid = layout?.pages?.find((page) => page.kind === 'grid')
  return grid?.widgets?.length ?? 0
}

function compute(width, height, widgetCount = 10) {
  const isWidescreen = width >= 1000 && width > height
  const cols = isWidescreen ? 5 : Math.max(1, Math.min(3, Math.floor((width - gutter) / (200 + gutter))))
  // Derive rows from actual widget count, not a static constant:
  const rows = isWidescreen ? 3 : Math.ceil(widgetCount / cols)
  // ...
}
```

### Grid placement contract

The layout harness is authoritative for placement. Display widgets must begin at the page's top-left content edge unless a page-specific placement contract says otherwise. A dedicated single-widget page must declare its span explicitly (for example `col: '1 / 4', row: '1 / 3'`) and the harness must assert the start line, span, page surface, and widget count. Update responsive geometry and E2E page-index expectations whenever adding a page.

### True Geometric Centering

When centering content inside a tall or square slot with a status header:
- **The Gotcha**: Setting `justify-content: space-between` on the tile with `.widget-state` at the top causes `.widget-body` to center only in the *remaining* height. The visual center is shifted upward by half the header's height.
- **The Solution**: Anchor the status/header line absolutely:
  ```css
  .widget-tile {
    position: relative;
    justify-content: center; /* Body occupies full height */
  }
  .widget-header-state {
    position: absolute;
    top: var(--odk-widget-inset);
    left: 0;
    right: 0;
    text-align: center;
  }
  ```
  This guarantees mathematical and optical centering (`dX = 0, dY = 0`).

---

## 5. Visual Craft & Design Discipline

All styling must adhere to `../../DESIGN.md` semantic tokens (`--odk-*`).

### Core Aesthetic Rules

1. **No Colored Backgrounds / Inactive is Quiet**:
   Do not introduce tinted surfaces (`--odk-elevated`) or solid-filled badge backgrounds for cards or sub-rows. Inactive cards and sub-rows remain transparent charcoal.
2. **Color Exclusively for State**:
   Color is reserved for functional state indication (green for healthy/live, red for dry/warning, blue for in-progress action). In-progress action states always take precedence over threshold alerts.
3. **Status Badges**:
   Badges are outlined pills (`border: 1px solid color-mix(...)`, colored text, transparent background). Solid color fields look noisy on the desk companion.
4. **Stacked Metric Hierarchy**:
   For vertical tiles, stack the label above large tabular numerals (`label` above `value + unit`) rather than horizontal key-value rows. This fills the vertical column naturally and prevents truncation.
5. **Display Numeral Tracking (`letter-spacing`)**:
   - Apply `-0.02em` negative tracking to large display numerals in vector fonts (`Montserrat`) so digits tighten as they grow.
   - **Crucial**: Explicitly reset `letter-spacing: normal` (or `0`) on bitmap pixel fonts (`Zpix` in Pixel theme). Negative letter-spacing on a fixed bitmap font distorts glyph alignment on the pixel grid.
6. **Accessible Text Floor**:
   Every rendered span and supporting label must maintain at least `12px` font size to pass `widget-app-styles.cjs` automated inspections.

---

## 6. Verification Harnesses & Density Gates

Verify through observable, machine-readable output — never by looking at a rendered image. The session model may be text-only and a screenshot cannot be asserted, diffed, or trusted for exact geometry. Measure the live DOM instead.

For focused widget changes, run the smallest relevant tests first, then the full gates. Network-backed widgets also need fixtures for unavailable, malformed, slow, unauthorized, and empty API responses.

```bash
cd runtime/linux
pnpm test                               # unit + integration tests
bash tests/smoke.sh                     # skeleton purity, token parity, layout harness
npx electron tests/widget-app-styles.cjs # 12px text floor, container bounds, no truncation
npx electron tests/widget-density.cjs --report-only # multi-theme, 5-resolution density suite
```

### Measure layout, do not eyeball it

When a visual defect is reported (clipped text, wrong gap, cover not filling its box), reproduce it as numbers over CDP rather than screenshotting pixels. Attach to the running renderer's `--remote-debugging-port` and evaluate geometry:

```js
// Run via CDP Runtime.evaluate against the widget tile:
const t = document.querySelector('[data-widget="odk.tile.weread"]')
const box = t.getBoundingClientRect()
const cover = t.querySelector('.weread-cover-wrap').getBoundingClientRect()
const text = t.querySelector('.weread-text')
JSON.stringify({
  tile: { h: Math.round(box.height) },
  coverFillsHeight: Math.abs(cover.height - box.height) <= 2,
  textOverflows: text.scrollHeight > text.clientHeight + 1,
  fontSizePx: getComputedStyle(text).fontSize,
})
```

This is faster and more reliable than capturing a PNG and sampling colors with PIL. A screenshot is only a human-facing artifact; it is never the acceptance check. If the numbers already prove the fix, no screenshot is needed.

### Density Harness Targets (`widget-density.cjs`)

- **Content Envelope Fill**: 62% target (accepted band: 54% to 70%).
- **Occupied Area Union**: >= 20% (relaxed via custom profile for sparse numeric instruments).
- **Max Empty Band**: <= 28%.
- For content-heavy widgets, test long strings, CJK wrapping, image load completion, and the smallest supported font size. Never use line clamping to hide overflow when the requirement is to show all content; fit against a fixed container after fonts and images settle.
- For detailed density tuning, custom widget profiles, and font-settling race conditions, see [references/density-and-styling.md](references/density-and-styling.md).

---

## 7. Shared Dirty Worktree Git Protocol

When collaborating in a working directory where other agents have uncommitted changes:
- **Never run raw `git add` or `git commit`** (blocked by repository workflow).
- **The `git-agent commit --no-stage` trap**: `git-agent commit --no-stage` will re-stage dirty files from the worktree, sweeping other agents' in-flight hunks into your commit.
- **The Worktree Neutralization Pattern**: Reconstruct HEAD + own hunks in the index, temporarily swap worktree files with staged copies, commit with `git-agent`, and immediately restore worktree files.
- Full step-by-step procedure is documented in [references/shared-worktree-git.md](references/shared-worktree-git.md).

---

## 8. CM5 Device Deployment & Operational Health

Deployment stages an immutable release to the CM5 and updates the atomic symlink:

```bash
bash runtime/linux/scripts/cm5-stage-release.sh
```

### Operational Traps

1. **Release Disk Accumulation (`No space left on device`)**:
   Each release directory under `/opt/open-deskos/releases/` consumes ~410MB (including Electron arm64 and node_modules). After ~20 deploys, the 28GB root partition hits 100%. Old releases must be pruned regularly while keeping `current` and the immediate rollback release.
2. **MQTT Client ID Conflicts**:
   Always suffix client IDs with process PID or random hex (`open-deskos-shell-${pid}-${rand}`). Fixed client IDs cause mutual connection eviction between the active kiosk service and testing processes.
3. **Active-release verification**:
   Never assume a release ID discussed earlier in a session is still active. Check `readlink -f /opt/open-deskos/current` immediately before copying files or restarting. The process app path, `current` symlink, and service environment must agree.
4. **Headless X11 navigation (last resort)**:
   Prefer a CDP geometry probe (see section 6). Only when CDP is unavailable, drive the panel with X11 keys and read state back programmatically rather than inspecting a captured image:
   ```bash
   DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 xdotool key Right
   ```
- For complete deployment runbooks and systemd override instructions, see [references/cm5-deployment.md](references/cm5-deployment.md).

### Retrospective failure patterns

- A successful `curl` proves only host connectivity; it does not prove the Electron service has the API key, correct CSP, usable module resolution, or a renderer that can load the returned asset.
- A failed preflight is not permission to copy files into a sealed release. Fix missing source files, dependency installation, display-server assumptions, or verifier configuration in the source/deployment path, then redeploy atomically.
- Normalize known API variants at the source boundary, version the cache when its shape changes, and keep the widget honest when data is missing.
- Iterating on a widget by screenshotting it and sampling pixels is the slowest, least reliable loop here. Drive the fix from CDP-measured geometry and the existing harnesses; reserve a screenshot for a final human handoff, never as the verification itself.
