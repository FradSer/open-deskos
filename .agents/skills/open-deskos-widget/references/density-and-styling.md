# Widget Density & Styling Reference

This guide details the mathematical contracts, responsive adaptations, and theme gotchas governing Open DeskOS widget styling and the automated `widget-density.cjs` harness.

## 1. Density Harness Math (`tests/helpers/widget-density.js`)

The density harness measures rendered bounding boxes of text nodes, SVG outlines, and `.meter` elements across five standard resolutions:
- `1920x1280` (Default Widescreen)
- `1920x1080` (1080P Display)
- `960x640` (Compact 3-column)
- `480x854` (Compact 2-column portrait)
- `320x480` (Minimum 1-column portrait)

### Standard Target Band

- **Content Fill (`fill`)**: Ratio of the bounding box envelope of all visible elements to the inner frame area.
  - `target = 0.62`, `tolerance = 0.08` -> Accepted band: **54.0% to 70.0%**.
- **Occupied Area (`occupied`)**: Ratio of the geometric union of all element bounding boxes to the inner frame area.
  - Standard minimum: **>= 20.0%**.
- **Maximum Empty Band (`emptyBand`)**: Largest contiguous vertical gap between elements (including top/bottom borders) relative to frame height.
  - Standard maximum: **<= 28.0%**.

### Dedicated Instrument Profiles

Sparse numeric instruments (clocks, dials, telemetry rows) naturally carry less ink than text-heavy articles. Forcing them to hit `occupied >= 20%` leads to bloated font sizes or artificial decorative elements.

Configure dedicated profiles in `tests/widget-density.cjs`:

```javascript
const profiles = {
  // Clock: time-only numeral has low envelope height
  'odk.tile.clock': { target: 0.38, tolerance: 0.16, minOccupied: 0.18, maxEmptyBand: 0.36 },
  // Pomodoro: circular dial in tall 1x2 slot has bounded fill
  'odk.tile.pomodoro': { target: 0.42, tolerance: 0.14, minOccupied: 0.15, maxEmptyBand: 0.36 },
  // Telemetry widget: stacked numeric rows carry sparse ink
  'odk.tile.hydra': { target: 0.75, tolerance: 0.18, minOccupied: 0.07, maxEmptyBand: 0.35 },
  // Pi Sessions: hero numeral in 2x2 square
  'odk.tile.pi-sessions': { tolerance: 0.17, minOccupied: 0.12, maxEmptyBand: 0.30 },
}
```

---

## 2. Responsive Regimes: 1x2 vs 1x1 Compact Grids

In widescreen mode, tiles can span two rows (e.g. `row: '2 / 4'`). In narrow windows (<1000px), `shell.css` resets all grid placements to `auto !important`, forcing tiles to collapse into 1x1 squares.

### The Dual-Regime Scaling Strategy

A single set of font clamps cannot fit both a 722px-tall slot and a 202px-square compact cell. Use media queries keyed to widescreen to switch regimes:

```css
/* Base: Compact 1x1 cell sizing (prevents overflow on mobile/narrow) */
.widget-env-value {
  font-size: clamp(12px, 7cqi, 28px);
}
.widget-meter {
  height: 2cqi;
}

/* Widescreen: Tall 1x2 slot scaling */
@media (min-width: 1000px) and (min-aspect-ratio: 1/1) {
  .widget-env-value {
    font-size: clamp(24px, 17cqi, 60px);
  }
  .widget-meter {
    height: 3.5cqi;
  }
}

/* Compact override: collapse vertical stacks into 2x2 grid to prevent vertical overflow */
@media (max-width: 999px) {
  .widget-body {
    justify-content: space-between;
  }
  .widget-env {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5cqi;
  }
}
```

---

## 3. Typography & Theme Rules

### Montserrat Vector Tracking vs Zpix Bitmap Grid

- **Vector fonts (Montserrat / Noto Sans SC)**:
  Apply size-specific negative tracking to large display numerals:
  ```css
  .large-numeral {
    font-family: "Montserrat", sans-serif;
    font-size: clamp(24px, 18cqi, 64px);
    letter-spacing: -0.02em; /* Tightens numerals as they scale */
  }
  ```
- **Bitmap font (Zpix in Pixel theme)**:
  Negative tracking shifts bitmap glyphs off their pixel grid, causing subpixel anti-aliasing blur. Always reset tracking to normal in `pixel.css`:
  ```css
  [data-theme='pixel'] .large-numeral {
    letter-spacing: normal; /* Preserves crisp pixel alignment */
  }
  ```

---

## 4. Density Settle & Mock IPC Requirements

### Font Loading Race Conditions in Density Harness

When `widget-density.cjs` runs across themes, font switching (`Zpix` <-> `Montserrat`) can cause premature measurement before the font face settles, resulting in false `sparse-content` or `fill-outside-band` errors.

Ensure explicit font loading and double-`rAF` settling in `measureSize`:

```javascript
await win.webContents.executeJavaScript(`Promise.all([
  document.fonts.load('700 32px "Montserrat"'),
  document.fonts.load('400 16px "Noto Sans SC"'),
  document.fonts.load('400 16px "Zpix"'),
]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
await new Promise(resolve => setTimeout(resolve, 300))
```

### Mandatory IPC Mock Handlers

The density test runner creates its own Electron window without running `src/main.js`. If a new widget invokes an IPC endpoint (`window.odkPlatform.getSomething()`), that endpoint must be mocked in `tests/widget-density.cjs`:

```javascript
ipcMain.handle('odk-custom-status', () => fixtureState === 'live'
  ? { configured: true, connected: true, data: { ... } }
  : { configured: true, connected: false, data: null })
```
Missing mocks cause the widget to default to unconfigured `--` placeholders, which will fail density and accessibility text checks.
