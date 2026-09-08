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

## 2. Fault Isolation & Hardening (System Resilience)

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

## 3. Layout Geometry & Dynamic Grid Math

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

## 4. Visual Craft & Design Discipline

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

## 5. Verification Harnesses & Density Gates

Always verify changes through the complete test pipeline before deployment:

```bash
cd runtime/linux
pnpm test                               # 139+ unit tests
bash tests/smoke.sh                     # Skeleton purity, token parity, layout harness
npx electron tests/widget-app-styles.cjs # 12px text floor, container bounds, no truncation
npx electron tests/widget-density.cjs --report-only # Multi-theme, 5-resolution density suite
```

### Density Harness Targets (`widget-density.cjs`)

- **Content Envelope Fill**: 62% target (accepted band: 54% to 70%).
- **Occupied Area Union**: >= 20% (relaxed via custom profile for sparse numeric instruments).
- **Max Empty Band**: <= 28%.
- For detailed density tuning, custom widget profiles, and font-settling race conditions, see [references/density-and-styling.md](references/density-and-styling.md).

---

## 6. Shared Dirty Worktree Git Protocol

When collaborating in a working directory where other agents have uncommitted changes:
- **Never run raw `git add` or `git commit`** (blocked by repository workflow).
- **The `git-agent commit --no-stage` trap**: `git-agent commit --no-stage` will re-stage dirty files from the worktree, sweeping other agents' in-flight hunks into your commit.
- **The Worktree Neutralization Pattern**: Reconstruct HEAD + own hunks in the index, temporarily swap worktree files with staged copies, commit with `git-agent`, and immediately restore worktree files.
- Full step-by-step procedure is documented in [references/shared-worktree-git.md](references/shared-worktree-git.md).

---

## 7. CM5 Device Deployment & Operational Health

Deployment stages an immutable release to the CM5 and updates the atomic symlink:

```bash
bash runtime/linux/scripts/cm5-stage-release.sh
```

### Operational Traps

1. **Release Disk Accumulation (`No space left on device`)**:
   Each release directory under `/opt/open-deskos/releases/` consumes ~410MB (including Electron arm64 and node_modules). After ~20 deploys, the 28GB root partition hits 100%. Old releases must be pruned regularly while keeping `current` and the immediate rollback release.
2. **MQTT Client ID Conflicts**:
   Always suffix client IDs with process PID or random hex (`open-deskos-shell-${pid}-${rand}`). Fixed client IDs cause mutual connection eviction between the active kiosk service and testing processes.
3. **Headless X11 Verification**:
   When CDP debugging hangs on the kiosk renderer, use X11 utilities to navigate and inspect:
   ```bash
   DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 xdotool key Right
   DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 import -window root /tmp/screen.png
   ```
- For complete deployment runbooks and systemd override instructions, see [references/cm5-deployment.md](references/cm5-deployment.md).
