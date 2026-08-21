# aiodi

`aiodi` is the AIODI design system for the Open DeskOS on-device LVGL/Lua OS
shell: one source of truth for the AIODI palette, spacing, radius, and type
scale, plus reusable component builders on top of `lvgl`.

Load it with:

```lua
local aiodi = require("aiodi")
local lvgl = require("lvgl")
```

Design reference: Figma "AIODI / OS - Final" (file `aCjWcJawjHWCqXXxFVckjS`).
Target panel: Guition JC4880P443C, 480x800 portrait.

Two sizing worlds live here, deliberately:

- `space` / `radius` / `text` are authored **directly in device px** for
  480x800 (no implicit @2x).
- The **widget grid** (`ref` / `scale` / `px` / `grid_metrics` / `tile`) is
  authored on the Figma **320x480 reference canvas** and scaled onto whatever
  panel is running. Nothing in it is a device constant.

Every builder returns the created `lvgl` widget so you can chain, wire events
(`widget:on(...)`), or style it further.

## Tokens

### `aiodi.colors`

Lowercase `#rrggbb` strings (what the `lvgl` style parser expects).

- `bg` `#000000` — screen background (Figma token).
- `surface` `#171717` — card / tile / row fill (Figma token, measured off
  `Homepage / #1`).
- `elevated` `#1f1f1f` — raised tiles / widgets (derived; currently unused).
- `button` `#383838` — neutral button / chip / num-pad key (Figma token).
- `stroke` `#383838` — Card Stroke: every AIODI tile is outlined (Figma token).
- `stroke_focus` `#b5b5b5` — focused tile ring (Figma token).
- `primary` `#ffffff` — primary text (Figma token).
- `secondary` `#706f70` — secondary / caption text (Figma token).
- `red` `#eb5757`, `green` `#34c759`, `blue` `#025bc2` — accents (Figma tokens).

> These values are the single source for the voice-UI system prompt and its
> linter palette. `scripts/gen_tokens.lua` requires `aiodi.lua` and emits
> `aiodi_tokens.h` (C macros consumed byte-identically by `odk_voice_ui.c`
> and `sim_voice_ui.c`) plus `aiodi_tokens.css` (web). Re-run the generator
> after changing a color - the three no longer drift by hand.

### `aiodi.space` / `aiodi.radius` / `aiodi.text`

- `space` = `{ xs=4, sm=8, md=16, lg=24, xl=40 }`
- `radius` = `{ sm=8, md=16, lg=24, pill=999 }`
- `text` = `{ caption=20, body=28, title=40, display=96, mega=180 }` (px)
- `chrome` = `{ header_h=56, back_w=136, back_h=48 }` - device-px frame
  dimensions for `aiodi.app` (header height, back button size). Named, not
  magic.

Only `text.body` (28) renders with the built-in font — and only because the
board pins `CONFIG_LV_FONT_DEFAULT_MONTSERRAT_28`. Every other size needs a
font object loaded via `aiodi.font(size)` and passed as `opts.font`.

1:1 launcher tiles and status-bar glyphs use `aiodi.icon_label{name=, size=}`
— a label rendered from the **Font Awesome 6 Free Solid** subset font
(`fonts/fa-icons.ttf`, hb-subset of 13 glyphs), one solid colour each
(`opts.color`, default `primary`). Size ≈ 50% of the cell on home tiles
(user-tuned: 88% → 60% → 50%). SVG icons are NOT used: the LVGL
SVG→ThorVG software vector path (`lv_draw_sw_vector`) renders blank on the
P4 (decoder parses/sizes correctly, drawing is empty), and `<g transform>`
scaling is ignored by the parser. `aiodi.svg_icon` remains for compatibility
but launcher no longer calls it.
Mapped `name`s → FontAwesome codepoints: `mail`=F0E0 envelope,
`calendar`/`events`=F133, `settings`=F013 gear, `tasks`=F046 check square,
`hourglass`/`focus`=F254, `bell`=F0F3, `bolt`=F0E7 lightning, `dice`=F522,
`droplet`=F043, `star`=F005, `leaf`=F06C, `habit`=F0C2 cloud, `link`=F0C1,
`radar`=F0E7 (bolt), `arrow-big-left`=F060, `caret-left`=F0D9.
Adding a new icon: add the glyph to `fa-icons.ttf` with hb-subset (never
fontTools — it emits broken TTFs on macOS), then extend `FA_GLYPHS` in
`aiodi.lua`.

## Reference canvas — `aiodi.ref` / `scale` / `px` / `grid_metrics`

`aiodi.ref` holds every number measured off the Figma home screen at 320x480:
`w/h`, `cell` 96, `gutter` 16, `bar_h` 48, `radius` 20, `stroke` 2, plus
`ring`, `text` and `bar` sub-tables. The `bar` group includes the indicator
dot, active-pill, gap, and touch-slot metrics. Nothing else in the grid is a
constant.

- `aiodi.scale(w, h)` — uniform **fit** scale onto the live panel (defaults to
  `_G.WIDTH`/`_G.HEIGHT`). Takes the smaller of the two ratios, so a short
  panel never overflows; used by `px()` for fonts/splash/ring. The home grid
  does **not** use this for layout — see `grid_metrics`.
- `aiodi.px(v, w, h)` — scale one reference number to device px.
- `aiodi.grid_metrics(w, h)` — the whole grid geometry. The standard portrait
  panel uses `cols`/`rows` 3x4; compact panels at or below 320px on either axis
  use 2x2 and reject layouts that require larger spans.
  `cell` (always 1:1), `gutter` (identical on both axes), `status_h` (top
  bar), `peek_h` / `peek_pad` / `peek_inset` (bottom fullscreen-app peek
  strip + in-card margin), `w`, `h`, `radius`, `stroke`, and `x`/`y` (grid
  origin under the status bar). Leftover height goes into the peek strip.
  Memoized for the default panel size. In landscape (`w > h`, e.g. 928×262
  touch bar) returns a provisional 4-slot row with a 28px status bar
  (`orientation = "landscape"`); portrait is the only live path today
  (landscape panel not yet available, sim dual-target NT-2 pending).

At 480x800 this yields cell ~131, gutter 24, status_h 72, peek_h 108,
peek_pad 24. At 320x480 it collapses to 1:1 with the Figma board.

## `aiodi.font(size, opts)` / `aiodi.font_bold(size, opts)`

Load a TTF at `size` px, relative to the writable data root. Returns the font
object, or `nil` if font loading is unavailable — callers should fall back to
the inherited default font. `opts` is merged into the load config (e.g.
`{ cache_size = 16 }` for a digits-only label; the default is 256 glyphs).

- `font` → `aiodi.font_path`, `fonts/NotoSansSC-Regular.ttf`: CJK-capable but
  **Regular only**, and carries no FontAwesome glyphs.
- `font_bold` → `aiodi.font_bold_path`, `fonts/Montserrat-Bold.ttf`: the heavy
  weight the AIODI numerals are drawn in, **Latin/digits only** — never pass
  Chinese text to a label styled with it.

Handles are cached per `path:size`, so both faces can coexist at one size.

## Component builders

All `opts` are optional and override the AIODI defaults. Layout is done with an
`opts.flex = { flow=, main=, cross=, track= }` sub-table where supported.

- `aiodi.screen(opts)` — full-screen root painted with `colors.bg`. Override
  with `opts.bg_color`.
- `aiodi.load_anim(screen, anim, ms[, delay, auto_del])` — animated screen load
  (wraps the
  binding's `screen:load_anim`); falls back to a hard `screen:load()` if the
  anim binding is absent or errors, so navigation never dead-ends. `anim`
  defaults to `"fade"`; `ms` defaults to 250. `auto_del` asks LVGL to delete
  the previous screen after the transition.
- `aiodi.transition` — `{ splash=350, app_open=140, app_close=100, hero_open=180,
  hero_close=180 }` (ms). `app_open`/`app_close` drive the native App slide
  transitions; the `hero_*` tokens are retained for compatibility but unused by
  the current slide-only navigator.
- `aiodi.card(parent, opts)` — rounded surface container: `surface` fill,
  `radius.lg`, `space.md` padding, outlined (`colors.stroke` at the tile stroke
  weight, matching Figma Card Stroke). Pass `opts.flex` to lay out children.
- `aiodi.meter(parent, opts)` — Year / quota progress meter: ash track,
  clipped fill (square trailing edge), overlaid `label` + `value`. Required
  `w`/`h`/`pct`; optional `fill`, `font`, `radius` (default pill),
  `chrome` (`center`|`space_between`), `pad_x`. Returns
  `{ fill, value, track_w, bar_h }` for live updates.
- `aiodi.tile(parent, opts)` — the outlined rounded surface the home widget
  grid is built from: `surface` fill, `radius`/`border_width` from
  `grid_metrics()`, `colors.stroke` outline. `opts.col`/`opts.row` are
  **1-based** grid cells and `opts.col_span`/`opts.row_span` default to 1 —
  the size is derived, so never hand-compute a spanned width. Pass
  `opts.on_click` to make it tappable (it then becomes a button: the binding
  cannot clear `LV_OBJ_FLAG_CLICKABLE`, so a container's clickability is not
  worth betting navigation on). Requires a parent with `set_grid`.
- `aiodi.grid(parent, metrics)` — home grid using the supplied
  `grid_metrics()` result. Use this for every grid-based home page so spans,
  and let the board-sized metrics select the compact 2x2 geometry on S3.
  gutters, and overflow behavior stay identical to Homepage/#1. The supplied
  metrics are 3x4 on the P4 and 2x2 on the compact S3 panel.
- `aiodi.statusbar(parent, opts)` — transparent row, `space_between` / center by
  default; for a top/bottom dock of icons + time in secondary text.
- `aiodi.clock(parent, opts)` — big-numeral label (`primary`, default text
  `"00:00"`, default `text_align = "left"` so numerals hug the left edge of
  their flex cell like meter-row labels). Pass `opts.font =
  aiodi.font(aiodi.text.display)` for real size; pass `text_align = "center"`
  for a full-tile clock (e.g. the status-bar time).
- `aiodi.fit_bold_text{ text=, width=, padding=, max_size=, min_size= }` —
  construction-time text-layout harness for fixed numeric boxes. It measures
  the real loaded Montserrat Bold glyphs, selecting a cached font that fits the
  available width; use a widest representative probe such as `"88:88"`.
  It returns `{ font, size, width, line_height, available_width }` and must not
  be called from per-frame or per-second paint paths.
- `aiodi.title(parent, opts)` — primary-color text label.
- `aiodi.caption(parent, opts)` — secondary-color text label.
- `aiodi.app_icon(parent, opts)` — square launcher tile (button). `opts.size`
  sets both edges (default 88); `opts.text` is the glyph (use `ICONS.*`);
  `opts.accent` overrides the tile fill.
- `aiodi.app_frame(parent, opts)` — full-screen black App shell attached to an
  existing screen. Returns `(frame, content)`; `opts.title`/`opts.on_back` own
  the shared header. Its Back control uses a Tabler filled leading arrow, a
  geometrically centered label, and a fill-only native press acknowledgement.
  The Shell keeps this frame full-size and uses a solid
  surface cover to expand from a home Tile or Peek rectangle, so live text and
  controls are never visibly compressed.
- `aiodi.app(opts)` — creates a screen, mounts one `app_frame`, and returns
  `(screen, content)`. The Shell presents that screen with `load_anim`.
- `aiodi.list_row(parent, opts)` — full-width rounded surface row (`radius.md`,
  height 64). If `opts.text` is given a primary label is embedded and the row
  is returned; otherwise add children to the returned handle.
- `aiodi.empty(parent, opts)` / `aiodi.loading(parent, opts)` /
  `aiodi.error(parent, opts)` - centered state placeholder: an optional
  `opts.icon` (an SVG `name`) above `opts.text`. `error` uses accent red; the
  others secondary grey. Pass `opts.w`/`opts.h` (the content area) so the
  placeholder centers within it. Replaces ad-hoc error captions.
- `aiodi.button(parent, opts)` — pill button (`radius.pill`). `opts.accent`
  picks the fill (default the neutral `button` token); `opts.text` is the label.
  Its `pressed_bg_opa` defaults to `176`, a fill-only press state that preserves
  button geometry; callers may override it for a different acknowledgement.

## Typical pattern

```lua
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local scr = aiodi.screen()
local bar = aiodi.statusbar(scr, { w = WIDTH, h = 40 })
aiodi.caption(bar, { text = ICONS.wifi .. " AIODI" })
aiodi.caption(bar, { text = ICONS.battery_3 .. " 73%" })
aiodi.clock(scr, { text = "22:32", font = aiodi.font(aiodi.text.display),
                   align = "center" })
scr:load()
```

## Practical rules

- Use the tokens (`aiodi.colors` / `space` / `radius` / `text`) instead of
  inline hex or magic numbers, so every screen stays on-system.
- Do not double-lock sizes: let a card size to its flex parent rather than
  fixing both. Pass `w`/`h` only where a fixed size is intentional.
- Big numerals (`text.title` and up) require a loaded font — never assume the
  default 28 px font scales.
- `opts` tables are consumed in place (helper keys like `size`, `accent`,
  `text`, `flex` are stripped before reaching `lvgl`); pass fresh table
  literals rather than reusing one table across builders.
