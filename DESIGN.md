---
name: Open DeskOS / AIODI
description: On-device LVGL/Lua OS shell design system for the desk companion panel
colors:
  bg: "#000000"
  surface: "#171717"
  elevated: "#1f1f1f"
  button: "#383838"
  stroke: "#383838"
  stroke-focus: "#b5b5b5"
  primary: "#ffffff"
  secondary: "#706f70"
  accent-red: "#eb5757"
  accent-green: "#34c759"
  accent-blue: "#025bc2"
typography:
  caption:
    fontFamily: "Noto Sans SC, Montserrat, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  body:
    fontFamily: "Montserrat, Noto Sans SC, sans-serif"
    fontSize: "28px"
    fontWeight: 400
  title:
    fontFamily: "Noto Sans SC, Montserrat, sans-serif"
    fontSize: "40px"
    fontWeight: 400
  display:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "96px"
    fontWeight: 700
  mega:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "180px"
    fontWeight: 700
  numeral-clock:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "52px"
    fontWeight: 700
  numeral-ring:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "48px"
    fontWeight: 700
  label:
    fontFamily: "Montserrat Bold, sans-serif"
    fontSize: "32px"
    fontWeight: 700
rounded:
  sm: "8px"
  md: "16px"
  lg: "24px"
  tile: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  gutter: "16px"
  cell: "96px"
components:
  tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.tile}"
    padding: "0"
  tile-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.tile}"
  button-pill:
    backgroundColor: "{colors.button}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "8px"
  card-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "16px"
    height: "64px"
  progress-track:
    backgroundColor: "{colors.button}"
    rounded: "{rounded.pill}"
  progress-fill-green:
    backgroundColor: "{colors.accent-green}"
    rounded: "{rounded.pill}"
  progress-fill-blue:
    backgroundColor: "{colors.accent-blue}"
    rounded: "{rounded.pill}"
  progress-fill-red:
    backgroundColor: "{colors.accent-red}"
    rounded: "{rounded.pill}"
---

# Design System: Open DeskOS / AIODI

## 1. Overview

**Creative North Star: "The Desk Instrument"**

AIODI is the visual language of a quiet instrument on the desk: black field, outlined tiles, heavy numerals you can read without thinking. It serves a developer glancing down beside a Mac keyboard, not a browser session. Density is deliberate and grid-locked (3×4 of 1:1 cells on a 320×480 Figma reference canvas, fit-scaled onto the live 480×800 Guition portrait panel). Color is restrained: neutrals carry the surface; red, green, and blue appear only when a single widget needs a state voice.

The system rejects SaaS analytics dashboards, neon cyber glass, generic AI purple gradients, nested cards, and side-stripe accents. Motion exists to convey navigation (page coast, snap, elastic overscroll, page-dot progress), never decoration.

**Key Characteristics:**
- Flat tonal layering (no drop shadows); depth from stroke and fill only
- Outlined tiles (`2px` stroke) as the home vocabulary
- Bold Montserrat numerals for time, countdown, and remaining %
- Equal H/V gutters; leftover height becomes the bottom app peek
- Launcher owns the frame; apps never invent their own chrome

## 2. Colors

A pure-black instrument face with charcoal surfaces and three accent instruments (alert, success, link/focus). Accents are scarce on purpose.

### Primary
- **Instrument White** (`#ffffff`): Primary text and active page-dot fill. The loudest neutral.

### Secondary
- **Mute Grey** (`#706f70`): Captions, secondary labels, spaced brand marks (`C L A U D E   C O D E`).

### Tertiary
- **Signal Red** (`#eb5757`): Alert / countdown ring / month accent. One job per screen when used.
- **Alive Green** (`#34c759`): Progress success (year bar, week remaining).
- **Focus Blue** (`#025bc2`): Saturated tile accent or 5-day remaining bar; the rare “this tile is special” fill.

### Neutral
- **Void Black** (`#000000`): Screen background (Figma Background / Black).
- **Card Charcoal** (`#171717`): Tile / card / peek / list-row fill.
- **Raised Charcoal** (`#1f1f1f`): Derived elevated fill (reserved; prefer `surface` unless lifting is intentional).
- **Button Ash** (`#383838`): Chip / key / progress track / card stroke.
- **Focus Ring** (`#b5b5b5`): Selected tile outline only.

### Named Rules
**The One Accent Job Rule.** Saturated color marks state or a single focal widget (ring, year fill, quota bar). Never decorate every tile.

**The Outlined Tile Rule.** Every home tile carries a `2px` `{colors.stroke}` outline. Focus swaps stroke to `{colors.stroke-focus}`, not a glow.

## 3. Typography

**Display Font:** Montserrat Bold (numerals / Latin heavy)
**Body Font:** Noto Sans SC Regular (CJK + UI copy) with Montserrat 28 as the LVGL default for icons
**Label/Mono Font:** none; digits reuse Montserrat Bold

**Character:** Instrument faces speak in weight and size, not ornament. Chinese titles stay on Noto Regular; countdown and clock never mix CJK into the bold face.

### Hierarchy
- **Mega** (700, `180px`): Rare full-bleed numerals.
- **Display** (700, `96px`): Hero numerals when a screen is only a number.
- **Numeral clock** (700, `52px` ref → scaled): Home clock tile and quota remaining %.
- **Numeral ring** (700, `48px` ref, hole-derived): Pomodoro arc center.
- **Title** (400, `40px`): App titles.
- **Label** (700, `32px` ref): Year bar labels, strong UI words.
- **Body** (400, `28px`): Default UI; Montserrat built-in carries `ICONS.*`.
- **Caption** (400, `20px`): Secondary lines, spaced SPE month, muted chrome.
- **Bar time** (700, `24px` ref): Status-bar clock.

### Named Rules
**The Bold Digits Rule.** AIODI numerals are Montserrat Bold only. Never pass Chinese through `font_bold`.

**The Scale Fit Rule.** Grid type sizes live in `aiodi.ref.text` and pass through `aiodi.px()`; do not hard-code device pixels for home chrome.

## 4. Elevation

AIODI is flat. Depth is tonal and stroked: black void → charcoal surface → ash stroke. No drop shadows (`shadow_width = 0` on tiles and buttons). Focus is a lighter stroke, not a lift.

### Shadow Vocabulary
- **None.** Shadows are prohibited on home tiles, pills, and cards.

### Named Rules
**The Flat-By-Default Rule.** Surfaces stay flat at rest. If it looks like a 2014 Material card, the shadow is wrong: remove it.

## 5. Components

### Buttons
- **Shape:** Pill (`radius.pill`) for chrome actions; square tiles for home launchers.
- **Primary (pill):** `{colors.button}` fill, `{colors.primary}` text, `space.sm` pad, no shadow.
- **Hover / Focus:** Touch-first; focus ring on tiles uses `{colors.stroke-focus}` border, not glow.
- **App icon button:** Square `radius.md`, optional `accent` fill (at most one saturated icon tile on Homepage/#1).

### Chips
- **Style:** Same ash as buttons (`#383838`); used for num-pad keys and compact controls.
- **State:** Pressed feedback via LVGL button; no second decorative layer.

### Cards / Containers
- **Corner Style:** Tile radius from grid metrics (`ref.radius` 20 → scaled); app cards use `radius.lg` (24px device).
- **Background:** `{colors.surface}` on black `{colors.bg}`.
- **Shadow Strategy:** None (see Elevation).
- **Border:** Tiles always `stroke` 2px; generic `card` builder historically omits border (prefer `tile` on home).
- **Internal Padding:** `space.md`–`space.lg`; peek in-card pad matches gutter scale.

### Inputs / Fields
- **Style:** List rows and buffers inside apps; surface fill, `radius.md`, `space.md` pad, height ~64px for rows.
- **Focus:** Follow tile focus stroke when the control is a launcher surface.
- **Error / Disabled:** Prefer caption secondary text; do not invent red borders without AIODI precedent.

### Navigation
- **Status bar:** Top glyphs + page dots + clock. Dots equal page count; active = wide white pill; width lerps while dragging.
- **Home pager:** Horizontal scroll, gutter between pages, `scrollbar` off, elastic + momentum, snap to page start.
- **Peek:** Bottom strip shows the last app’s live chrome; tap opens fullscreen.
- **App frame:** `aiodi.app` black screen + Back + title + content column. Apps must not create their own screen or trap Back.

### Signature: Home tile grid
- **3×4** of 1:1 cells, equal gutters, status above, peek below.
- Spans via `col_span` / `row_span` only; never hand-compute widths.
- SVG Tiny icons at ~56% of cell for optical margin.

### Signature: Progress (Year / quota)
- Built by `aiodi.meter`: track = ash; fill = green/blue/red child with square
  trailing edge; label + `%` overlaid (`fonts.label`).
- Homepage/#1 Year sits inside an outlined tile (`radius` 0 on the meter —
  the tile clips). Homepage/#2 quota meters use the tile radius inside the
  agent card.

## 6. Do's and Don'ts

### Do:
- **Do** require `aiodi` and build from `screen` / `tile` / `app` / `clock` / `caption` / `button`.
- **Do** keep Homepage/#1 to one saturated icon tile; leave green for progress and red for the ring.
- **Do** size touch hits larger than the visible page-dot pill.
- **Do** use momentum + snap for horizontal pages; update dots during scroll.
- **Do** keep Back owned by the launcher frame.

### Don't:
- **Don't** build SaaS analytics dashboards (hero metrics stacks, identical card grids, purple gradients).
- **Don't** use neon cyber styling or glassmorphism for decoration.
- **Don't** ship generic AI landing-page aesthetics on-device.
- **Don't** nest cards inside cards or use side-stripe borders as accents.
- **Don't** add decorative motion that does not convey state.
- **Don't** hard-code `/fatfs` or device pixel constants for the widget grid; use `grid_metrics` / `px`.
- **Don't** call missing LVGL C-API names from Lua (`lvgl.cont_create`, `lvgl.ALIGN.*`).
- **Don't** drop shadows on AIODI tiles or pills.
