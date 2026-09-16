# Built-in Tile Examples

Five canonical `1x1` tiles to copy from, not abstractions to wrap. All are `kind: 'tile'`, `interaction: 'display-only'`, with truthful placeholders before data arrives.

## 1. Pending status — `odk.tile.chat` / `odk.tile.settings` (`plugins/chat.js`, `plugins/settings.js`)

The pattern for small tiles whose integration is absent. Name first, corner icon second, value third, detail last. DOM order is the reading order.

```html
<div class="widget-status-layout">
  <span class="widget-status-name">Chatbot</span>
  <svg class="widget-corner-icon" data-tabler="message" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">…</svg>
  <strong class="w-state widget-status-value">Pending</strong>
  <span class="widget-status-detail">Integration not available</span>
</div>
```

Copy this:

- No buttons, inputs, or multi-step flows inside a `1x1`.
- `state: 'Pending integration'` in the registration when the backing integration is absent; the rendered value/detail must say the same thing (`Pending` / `Integration not available`). Truthful states only.
- One Tabler outline icon (`data-tabler`), `aria-hidden="true"`. Chat uses `message`, Settings uses `settings`.
- Value is a single short noun (`<strong class="w-state widget-status-value">`); detail is one short clause. No wrapping paragraphs.
- Layout roles (`shell.css`): `.widget-status-layout` is a `flex` column, vertically centered, `gap: 2cqi`; `.widget-status-name` is an uppercase Montserrat label with `padding-inline-end: 36px` so long names clear the corner icon; `.widget-corner-icon` is pinned top-right (`--odk-widget-inset`), `clamp(24px, 9cqi, 32px)`; `.widget-status-value` is a Montserrat bold display reading with `margin-top: auto`; `.widget-status-detail` is a secondary line at `line-height: 1.4`.
- Do not use it for live numeric instruments (clock, telemetry, progress): they need dedicated density profiles in `tests/widget-density.cjs`, not the status pattern.

## 2. Calendar date — `odk.tile.almanac` (`plugins/almanac.js`)

Three stacked readings, no icon, no value/unit split. Weekday sits top-left outside the centered body.

```html
<span class="al-weekday"></span>
<div class="widget-signal al-body">
  <span class="al-day"></span>
  <span class="al-month"></span>
</div>
```

Copy this:

- Date-change guard: build a `renderedDate` key (`year-month-day`) and return early when unchanged, so `onTick` does not rewrite the DOM every minute.
- Digit-width classes: `al-day-wide` for 2-digit days, `al-day-narrow` for day 1, keeping the numeral optically centered.
- Short month via `toLocaleString('en-US', { month: 'short' })`.

## 3. Single reading — `odk.tile.clock` (`plugins/clock.js`)

The minimal tile: one `<time>` element, `--:--` placeholder until the first tick.

```html
<div class="widget-signal clock-body">
  <time class="w-clock-time">--:--</time>
</div>
```

Copy this:

- Zero-padded `HH:MM` reading; compare `textContent` before writing.
- Mirror the reading into the `dateTime` attribute for assistive technology.
- No icon, no label, no units: the reading is the whole tile.

## 4. Reading plus meter — `odk.tile.year` (`plugins/year.js`)

A percentage reading with a context line and a linear meter underneath.

```html
<div class="widget-signal year-row">
  <div class="year-signal-line">
    <span class="year-pct">--%</span>
    <span class="year-context">of year elapsed</span>
  </div>
  <div class="meter" aria-hidden="true"><div class="meter-fill"></div></div>
</div>
```

Copy this:

- Dual precision: meter width at 2 decimals for smooth motion, text reading rounded to whole percent.
- Separate write guards: `renderedWidth` for the fill, `textContent` check for the label.
- `year-pct-wide` class at exactly 100% to hold centering when the glyph count grows.
- Meter is `aria-hidden`: the text reading already carries the information.

## 5. Multi-section telemetry — `odk.tile.hydra` (`plugins/hydra.js`)

Header (icon + title + state badge), 2x2 environment grid, and per-node rows with mini meters. The badge is the single state signal; body cells degrade to `--` independently.

```html
<div class="widget-signal hydra-body odk-col">
  <div class="hydra-head">
    <svg data-tabler="leaf" aria-hidden="true" …>…</svg>
    <span class="hydra-title">Hydra</span>
    <span class="hydra-badge" id="hydra-badge">…</span>
  </div>
  <div class="hydra-env">
    <div class="hydra-env-cell" id="hydra-env-temp"><span class="hydra-env-label">Temp</span><span class="hydra-reading"><span class="hydra-env-value">--</span><span class="hydra-env-unit">°C</span></span></div>
    <!-- humidity / pressure / light cells follow the same shape -->
  </div>
  <div class="hydra-plants">
    <div class="hydra-plant hydra-idle" id="hydra-plant-1">
      <div class="hydra-plant-row">
        <span class="hydra-plant-name">Plant 1</span>
        <span class="hydra-plant-soil">--</span>
      </div>
      <div class="hydra-meter" aria-hidden="true"><div class="hydra-meter-fill"></div></div>
    </div>
  </div>
</div>
```

Copy this:

- Badge state machine, exactly one visible at a time: `Unconfigured` (no snapshot) → `Waiting` (configured, disconnected) → `Offline` (main unit down) → `Stale env` / `Live`. Badge class follows state (`-muted` / `-warn` / `-live`).
- `render(null)` on mount so the tile is truthful before the first IPC reply.
- Throttled refresh: `ctx.onTick` counter with `REFRESH_EVERY_TICKS = 5`; `try/catch` around `odkPlatform.getHydraStatus()` degrades to the `Waiting` snapshot.
- Per-cell formatting helpers (`formatNumber`, `formatLux`, `formatPressure`, `formatSoil`); missing values render `--`, never blank or `NaN`.
- Updates via `textContent` / `style.width` / class toggles on cached refs; `innerHTML` is mount-time only.
- Row state classes on the plant root (`hydra-offline`, `hydra-stale`, `hydra-watering`) with a dry-soil threshold toggle (`hydra-meter-dry` below 50%).
