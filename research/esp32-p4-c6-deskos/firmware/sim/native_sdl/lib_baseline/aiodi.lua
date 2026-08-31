--
-- aiodi -- AIODI design system for the Open DeskOS on-device LVGL/Lua OS shell.
--
-- A thin, token-driven layer over `lvgl`: one source of truth for the AIODI
-- palette/spacing/radius/type scale, plus reusable component builders (screen,
-- card, status bar, big-numeral clock, app icon, list row, pill button).
--
-- Design reference: Figma "AIODI / OS - Final" (file aCjWcJawjHWCqXXxFVckjS).
-- Colors marked (token) are exact Figma variables.
--
-- Every builder returns the created lvgl widget so callers can chain/style
-- further. Two sizing worlds live here, deliberately:
--   * `space`/`radius`/`text` are authored directly in device px for 480x800.
--   * the widget grid (`ref`/`px`/`grid_metrics`/`tile`) is authored on the
--     Figma 320x480 reference canvas as a 3x4 of 1:1 cells with equal H/V
--     gutters; leftover panel space is outer margin, not stretched gaps.
--
local lvgl = require("lvgl")

local M = {}

M.VERSION = "0.1.0"

-- Palette ------------------------------------------------------------------
-- Lowercase hex; lvgl's style parser wants 7-char "#rrggbb".
M.colors = {
    bg = "#000000",           -- (token) Background / Black
    surface = "#171717",      -- (token) card / tile fill, measured off Homepage/#1
    elevated = "#1f1f1f",     -- (derived) raised tiles / widgets
    button = "#383838",       -- (token) Button Background (num-pad keys, chips)
    stroke = "#383838",       -- (token) Card Stroke -- every AIODI tile is outlined
    stroke_focus = "#b5b5b5", -- (token) focused tile ring
    primary = "#ffffff",      -- (token) Primary / White text
    secondary = "#706f70",    -- (token) Secondary text
    red = "#eb5757",          -- (token) accent Red
    green = "#34c759",        -- (token) accent Green
    blue = "#025bc2",         -- (token) accent Blue
}

-- Spacing / radius scale (px) ---------------------------------------------
M.space = { xs = 4, sm = 8, md = 16, lg = 24, xl = 40 }
M.radius = { sm = 8, md = 16, lg = 24, pill = 999 }

-- Type scale (px). Only `body` (28) renders with the built-in Montserrat 28
-- font; every other size needs a font loaded via M.font(size) and passed in.
M.text = { caption = 20, body = 28, title = 40, display = 96, mega = 180 }

-- Chrome (device px for 480x800, same world as space/radius/text). Named frame
-- dimensions for M.app so the header and back button aren't magic numbers.
M.chrome = { header_h = 56, back_w = 136, back_h = 48 }

-- TTFs, relative to the writable data root. `font_path` is CJK-capable but
-- Regular-only; `font_bold_path` is Latin/digits-only but carries the heavy
-- weight the AIODI numerals are drawn in.
M.font_path = "fonts/NotoSansSC-Regular.ttf"
M.font_bold_path = "fonts/Montserrat-Bold.ttf"

-- Reference canvas ---------------------------------------------------------
-- The AIODI home screen (Figma `Homepage / #1`, node 4403:4473) is drawn on a
-- 320x480 board. Every number below is measured off that board -- nothing in
-- the widget grid is a device constant. M.px() scales them onto the live
-- panel, so the same composition lands on any resolution.
M.ref = {
    w = 320, h = 480,
    cell = 96, gutter = 16, bar_h = 48, radius = 20, stroke = 2,
    -- Ring widget (Figma Homepage/#1): measured on a 208px 2x2 tile —
    -- diameter 138 (~2/3 of the tile), inset 32, stroke 24. Live sizing
    -- keeps that outer ratio and only thins the stroke if the "Wnn" hole
    -- would otherwise collide with the arc.
    ring = { d = 138, inset = 32, w = 24 },
    text = { spe = 18, day = 32, clock = 52, ring = 48, label = 32, bar_time = 24 },
    bar = {
        icon = 20,
        icon_gap = 4,
        icon_x = 8,
        dot = 12,
        dot_gap = 10,
        dot_active = 28,
        dot_hit = 30,
        pad_r = 16,
    },
    -- Bottom app peek: a fullscreen-app card whose top peeks above the fold.
    -- `strip_min` floors the visible peek height (must fit inner pad×2 + a
    -- control row); `pad` is the in-card margin (scaled like gutter). Leftover
    -- panel height expands the strip so the 3x4 grid stays 1:1.
    peek = { strip_min = 72, inset = 16, pad = 16 },
}

-- Internals ----------------------------------------------------------------

-- Shallow-merge: a fresh table of `defaults` overlaid by `opts` (opts wins).
local function merged(defaults, opts)
    local out = {}
    for k, v in pairs(defaults) do
        out[k] = v
    end
    if opts then
        for k, v in pairs(opts) do
            out[k] = v
        end
    end
    return out
end

-- Pull the layout `flex` sub-table out of an opts table so it is applied via
-- set_flex() rather than passed to the widget constructor.
local function take_flex(opts)
    local flex = opts.flex
    opts.flex = nil
    return flex
end

-- Memoized font handles keyed by "path:size" -- the path has to be part of the
-- key or the regular and bold faces evict each other at the same size. `false`
-- marks a failed load so we do not retry it.
M._font_cache = {}

local function font_at(path, size, opts)
    if type(lvgl.font_load) ~= "function" then
        return nil
    end
    local key = path .. ":" .. size
    if not opts then
        local cached = M._font_cache[key]
        if cached ~= nil then
            return cached or nil
        end
    end
    local cfg = { size = size }
    if opts then
        for k, v in pairs(opts) do
            cfg[k] = v
        end
    end
    local ok, font = pcall(lvgl.font_load, path, cfg)
    local result = (ok and font) or nil
    if not opts then
        M._font_cache[key] = result or false
    end
    return result
end

function M.clear_font_cache()
    M._font_cache = {}
end

-- Load a CJK-capable TTF font at `size`; returns nil if font loading is
-- unavailable so callers fall back to the inherited default (Montserrat, which
-- carries the ICONS.* glyphs but no CJK). Cached unless custom `opts` are given.
function M.font(size, opts)
    return font_at(M.font_path, size, opts)
end

-- Bold face, for the AIODI numerals. Latin/digits only -- never pass Chinese
-- text to a label styled with this. nil if the TTF is missing, in which case
-- the caller silently falls back to the inherited default font.
function M.font_bold(size, opts)
    return font_at(M.font_bold_path, size, opts)
end

-- Reference-canvas scaling -------------------------------------------------

-- Uniform fit scale from the 320x480 reference canvas onto the live panel.
-- Takes the smaller of the two ratios so a short panel never overflows; the
-- leftover is black margin, which is invisible on an AIODI screen.
function M.scale(w, h)
    w = w or _G.WIDTH or M.ref.w
    h = h or _G.HEIGHT or M.ref.h
    return math.min(w / M.ref.w, h / M.ref.h)
end

-- Scale one reference-canvas number to device px.
function M.px(v, w, h)
    return math.floor(v * M.scale(w, h) + 0.5)
end

local metrics_cache

-- Widget-grid geometry for the live panel. Base grid is 3x4 (Figma
-- Homepage/#1). Cells are always 1:1; H/V gutters are the SAME value —
-- including the gap between the grid and the bottom app peek.
-- Chrome: status bar on top, fullscreen-app peek strip at the bottom.
-- Memoized for the default panel size, which does not change at runtime.
function M.grid_metrics(w, h)
    if not w and not h and metrics_cache then
        return metrics_cache
    end
    local pw = w or _G.WIDTH or M.ref.w
    local ph = h or _G.HEIGHT or M.ref.h
    -- Landscape touch bar (e.g. 928×262 landscape bar, spec §5/§7): 28px status bar,
    -- 928×234 content, 4 1:1 slots in a row. PROVISIONAL - S/M/L slot sizing is
    -- pending spec detail; gated on landscape panel availability + NT-2 (sim
    -- dual-target). Portrait is the only live path today; this branch is the
    -- forward-compat hook so AIODI reflows rather than rewrites when it lights.
    if pw > ph then
        local fit = pw / 928
        local cols, rows = 4, 1
        local gutter = math.floor(M.ref.gutter * fit + 0.5)
        local status_h = math.max(20, math.floor(28 * fit + 0.5))
        local content_h = ph - status_h
        local cell = math.min((pw - (cols - 1) * gutter) // cols, content_h)
        local gw = cols * cell + (cols - 1) * gutter
        local gh = cell
        local m = {
            cols = cols, rows = rows,
            cell = cell, cell_w = cell, cell_h = cell,
            gutter = gutter, gutter_x = gutter, gutter_y = gutter,
            status_h = status_h, bar_h = status_h,
            peek_h = 0, peek_gap = 0, peek_pad = 0, peek_inset = 0, handle_h = 0,
            w = gw, h = gh,
            x = (pw - gw) // 2,
            y = status_h + (content_h - gh) // 2,
            peek_y = ph,
            radius = math.floor(M.ref.radius * fit + 0.5),
            stroke = math.max(1, math.floor(M.ref.stroke * fit + 0.5)),
            orientation = "landscape",
        }
        if not w and not h then metrics_cache = m end
        return m
    end
    local cols, rows = 3, 4
    local fit = math.min(pw / M.ref.w, ph / M.ref.h)
    local gutter = math.floor(M.ref.gutter * fit + 0.5)
    local status_h = math.floor(M.ref.bar_h * fit + 0.5)
    local peek_min = math.floor(M.ref.peek.strip_min * fit + 0.5)
    local peek_pad = math.floor(M.ref.peek.pad * fit + 0.5)
    -- One gutter between grid and peek, same as between tiles.
    local peek_gap = gutter
    -- Largest square cell under status, peek floor, peek gap, and row gutters.
    local cell = math.min(
        (pw - (cols - 1) * gutter) // cols,
        (ph - status_h - peek_min - peek_gap - (rows - 1) * gutter) // rows)
    local gw = cols * cell + (cols - 1) * gutter
    local gh = rows * cell + (rows - 1) * gutter
    -- Leftover height becomes the peek strip (never below peek_min).
    local peek_h = math.max(peek_min, ph - status_h - gh - peek_gap)
    local m = {
        cols = cols, rows = rows,
        cell = cell,
        cell_w = cell, cell_h = cell,
        gutter = gutter,
        gutter_x = gutter, gutter_y = gutter,
        status_h = status_h,
        bar_h = status_h, -- alias: older callers
        peek_h = peek_h,
        peek_gap = peek_gap,
        peek_pad = peek_pad,
        peek_inset = math.floor(M.ref.peek.inset * fit + 0.5),
        handle_h = peek_h,
        w = gw, h = gh,
        x = (pw - gw) // 2,
        y = status_h,
        -- Peek sits one gutter below the grid, matching tile spacing.
        peek_y = status_h + gh + peek_gap,
        radius = math.floor(M.ref.radius * fit + 0.5),
        stroke = math.max(1, math.floor(M.ref.stroke * fit + 0.5)),
    }
    if not w and not h then
        metrics_cache = m
    end
    return m
end

-- Builders -----------------------------------------------------------------

-- Full-screen root with the AIODI black background. `opts.bg_color` overrides.
-- Screens never scroll: LVGL makes plain objects scrollable by default, which
-- puts a scrollbar on fixed compositions (splash, home) and lets a drag shove
-- the whole page. App content that needs a list scrolls its own column.
function M.screen(opts)
    local scr = lvgl.create_screen()
    local style = merged({ bg_color = M.colors.bg }, opts)
    scr:set_style(style)
    scr:set_scroll({ dir = "none", scrollbar = "off" })
    return scr
end

-- Motion ------------------------------------------------------------------
-- Screen-load transition durations. Hero navigation expands a solid surface
-- continuity surface instead of scaling live App content. Matching durations
-- make the return path feel like a true inverse on the partial-refresh panel.
M.transition = {
    splash = 350,
    app_open = 140,
    app_close = 100,
    hero_open = 180,
    hero_close = 180,
}

-- Natural deceleration for an entering surface. This is deliberately monotonic
-- and overshoot-free so the source widget remains the visual anchor.
function M.ease_out(t)
    t = math.max(0, math.min(1, t))
    local inverse = 1 - t
    return 1 - inverse * inverse * inverse
end

-- Animated screen load: thin wrapper over the binding's screen:load_anim.
-- Falls back to a hard screen:load() if the anim binding is absent or errors,
-- so navigation never dead-ends on a build without LVGL anim support.
function M.load_anim(screen, anim, ms, delay, auto_del)
    if not screen then return end
    local ok = pcall(function()
        screen:load_anim(anim or "fade", ms or 250, delay or 0, auto_del or false)
    end)
    if not ok and type(screen.load) == "function" then
        pcall(screen.load, screen)
    end
end

-- Rounded surface card. Defaults: surface fill, large radius, md padding,
-- outlined (Card Stroke at the tile stroke weight). Pass `opts.flex = {...}`
-- to lay out its children.
function M.card(parent, opts)
    opts = opts or {}
    local flex = take_flex(opts)
    local cfg = merged({
        bg_color = M.colors.surface,
        radius = M.radius.lg,
        pad = M.space.md,
        -- Figma Card Stroke: every AIODI card is outlined, same weight as a
        -- home tile. (Was border_width = 0; reconciled 2026-07-24.)
        border_width = math.max(1, M.px(M.ref.stroke)),
        border_color = M.colors.stroke,
    }, opts)
    local card = lvgl.container(parent, cfg)
    if flex then
        card:set_flex(flex)
    end
    return card
end

-- Progress meter: ash track + clipped fill + overlaid label/value.
-- Shared language for Homepage/#1 Year and Homepage/#2 quota windows.
-- Fill trailing edge stays square; leading edge follows `opts.radius` clip.
--   opts.w / opts.h / opts.pct (0–100) / opts.fill
--   opts.label / opts.value / opts.font
--   opts.radius (default pill) / opts.chrome ('center'|'space_between')
-- Returns { fill=, value=, track_w=, bar_h= } for live width updates.
function M.meter(parent, opts)
    opts = opts or {}
    local w = assert(opts.w, "aiodi.meter: w required")
    local h = assert(opts.h, "aiodi.meter: h required")
    local pct = math.max(0, math.min(100, tonumber(opts.pct) or 0))
    local fill_w = math.max(1, (w * pct) // 100)
    local radius = opts.radius or M.radius.pill
    local chrome_main = opts.chrome or "center"
    local pad_x = opts.pad_x or M.space.md

    local track = lvgl.container(parent, {
        w = w, h = h,
        bg_color = M.colors.button,
        radius = radius,
        border_width = 0, pad = 0, clip_corner = 1 })
    track:set_scroll({ dir = "none", scrollbar = "off" })

    local fill = lvgl.container(track, {
        x = 0, y = 0, w = fill_w, h = h,
        bg_color = opts.fill or M.colors.green,
        radius = 0, border_width = 0, pad = 0 })

    local chrome = lvgl.container(track, {
        x = 0, y = 0, w = w, h = h,
        bg_opa = 0, border_width = 0,
        pad_left = pad_x, pad_right = pad_x, pad_top = 0, pad_bottom = 0 })
    chrome:set_scroll({ dir = "none", scrollbar = "off" })
    chrome:set_flex({
        flow = "row", main = chrome_main, cross = "center", track = "center" })
    if opts.label then
        M.title(chrome, { text = opts.label, font = opts.font })
    end
    local value
    if opts.value ~= nil then
        value = M.title(chrome, { text = opts.value, font = opts.font })
    end
    return { fill = fill, value = value, track_w = w, bar_h = h }
end

-- Horizontal status/dock bar: transparent row, space-between, secondary text.
function M.statusbar(parent, opts)
    opts = opts or {}
    local flex = take_flex(opts) or
        { flow = "row", main = "space_between", cross = "center", track = "center" }
    local cfg = merged({
        bg_opa = 0,
        border_width = 0,
        pad = M.space.sm,
        pad_column = M.space.sm,
    }, opts)
    local bar = lvgl.container(parent, cfg)
    bar:set_flex(flex)
    return bar
end

-- Big-numeral clock/label. For a real display size pass `opts.font = M.font(
-- M.text.display)`; without it the inherited default font is used.
function M.clock(parent, opts)
    local cfg = merged({ text = "00:00", text_color = M.colors.primary }, opts)
    return lvgl.label(parent, cfg)
end

-- Primary title text.
function M.title(parent, opts)
    return lvgl.label(parent, merged({ text_color = M.colors.primary }, opts))
end

-- Secondary/caption text.
function M.caption(parent, opts)
    return lvgl.label(parent, merged({ text_color = M.colors.secondary }, opts))
end

-- SVG Tiny 1.2 icon set (viewBox 0 0 24 24). One optical language for every
-- 1:1 tile: ~2.25 unit margin, 1.5 stroke, round caps/joins, outline-only.
-- No path arc (A/a) — LVGL's decoder is Tiny 1.2 only. `%s` = colour.
local SVG_SHAPES = {
    -- Mail: soft body + inset flap (flap stops short of the rim).
    envelope = [[
<rect x="2.5" y="4.75" width="19" height="14.5" rx="2.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M4.4 6.6 L12 12.6 L19.6 6.6"/>
]],
    -- Num pad: framed 3×3 of equal outline keys (same weight as mail/settings).
    keyboard = [[
<rect x="2.5" y="4" width="19" height="16" rx="2.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<rect x="4.9" y="6.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="10.4" y="6.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="15.9" y="6.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="4.9" y="10.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="10.4" y="10.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="15.9" y="10.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="4.9" y="14.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="10.4" y="14.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
<rect x="15.9" y="14.4" width="3.2" height="3.2" rx="0.85" fill="none" stroke="%s" stroke-width="1.5"/>
]],
    -- Settings: regular pointy-top hex + quiet hub.
    settings = [[
<polygon points="12,3.1 19.7,7.55 19.7,16.45 12,20.9 4.3,16.45 4.3,7.55" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="12" cy="12" r="3.25" fill="none" stroke="%s" stroke-width="1.5"/>
]],
    -- Refresh: paired arcs via cubics + small arrowheads (pomodoro glyph).
    refresh = [[
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round"
  d="M18.2 6.8 C16.2 3.6 12.2 2.4 8.6 3.6 C5 4.8 2.8 8 3.4 11.6"/>
<path fill="%s" d="M17.6 3.1 L21.6 7.6 L15.4 8.1 Z"/>
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round"
  d="M5.8 17.2 C7.8 20.4 11.8 21.6 15.4 20.4 C19 19.2 21.2 16 20.6 12.4"/>
<path fill="%s" d="M6.4 20.9 L2.4 16.4 L8.6 15.9 Z"/>
]],
    -- Store: simple shop awning + storefront (App Center icon).
    store = [[
<rect x="3" y="9" width="18" height="11" rx="1.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M2 9 L5 4 L19 4 L22 9"/>
<line x1="3" y1="14" x2="21" y2="14" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Chat: rounded bubble + tail (Chat app).
    chat = [[
<rect x="3" y="5" width="18" height="13" rx="2.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M7 18 L7 21 L11 18"/>
]],
    -- Send: paper plane (Chat send button).
    send = [[
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M4 12 L20 4 L13 20 L11 13 Z"/>
<line x1="11" y1="13" x2="20" y2="4" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Wi-Fi: three nested arcs (cubics, no A command) + dot (status bar, Settings).
    wifi = [[
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" d="M3 8 C7 4 17 4 21 8"/>
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" d="M6 11 C9 8 15 8 18 11"/>
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" d="M9 14 C10.5 12.5 13.5 12.5 15 14"/>
<circle cx="12" cy="17" r="1.2" fill="%s"/>
]],
    -- Calendar: framed card + header tabs (Calendar/usage app).
    calendar = [[
<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<line x1="3" y1="9" x2="21" y2="9" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
<line x1="8" y1="3" x2="8" y2="6" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
<line x1="16" y1="3" x2="16" y2="6" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Timer: clock face + hands + stem (Pomodoro).
    timer = [[
<circle cx="12" cy="13" r="8" fill="none" stroke="%s" stroke-width="1.5"/>
<line x1="12" y1="13" x2="12" y2="8" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
<line x1="12" y1="13" x2="15" y2="14" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
<line x1="12" y1="3" x2="12" y2="5" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Plus: add action.
    plus = [[
<line x1="12" y1="5" x2="12" y2="19" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
<line x1="5" y1="12" x2="19" y2="12" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Back: left chevron (replaces the text "<" in app back buttons).
    back = [[
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M15 5 L8 12 L15 19"/>
]],
    -- Trash: delete action.
    trash = [[
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M5 7 H19 M9 7 V5 H15 V7 M6 7 L7 20 H17 L18 7"/>
<line x1="10" y1="10" x2="10" y2="17" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
<line x1="14" y1="10" x2="14" y2="17" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Edit: pencil (rename/edit).
    edit = [[
<path fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
  d="M5 19 L5 15 L15 5 L19 9 L9 19 Z"/>
<line x1="13" y1="7" x2="17" y2="11" stroke="%s" stroke-width="1.5" stroke-linecap="round"/>
]],
    -- Server: stacked units + status LEDs (server status app).
    server = [[
<rect x="4" y="4" width="16" height="6" rx="1.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<rect x="4" y="14" width="16" height="6" rx="1.5" fill="none" stroke="%s" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="7" cy="7" r="0.8" fill="%s"/>
<circle cx="7" cy="17" r="0.8" fill="%s"/>
]],
}

-- Must match LUA_MODULE_LVGL_FS_LETTER in lua_lvgl_private.h.
local SVG_FS_LETTER = "D"

local function svg_document(name, size, color)
    local body = SVG_SHAPES[name]
    if not body then
        return nil
    end
    local inner = body:gsub("%%s", color)
    -- Bake scale into the file: LVGL's SVG decoder sizes from content
    -- bounds / viewBox, so a 24-unit viewBox stays a 24px image even when
    -- width/height say otherwise. Scale the artwork up and drop viewBox.
    local s = size / 24
    return string.format(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d"><g transform="scale(%.6f)">%s</g></svg>\n',
        size, size, s, inner)
end

local function ensure_svg_file(name, size, color)
    local rel = string.format("icons/%s_%d.svg", name, size)
    local doc = svg_document(name, size, color)
    if not doc then
        return nil
    end
    local f = io and io.open(rel, "r")
    local existing = f and f:read("*a") or nil
    if f then
        f:close()
    end
    if existing ~= doc then
        f = io and io.open(rel, "w")
        if not f then
            return nil
        end
        f:write(doc)
        f:close()
    end
    return SVG_FS_LETTER .. ":" .. rel
end

-- Vector icon for 1:1 tiles. Generates an SVG Tiny file at `size` px and
-- renders it with lvgl.image. Callers typically pass ~0.55–0.6·cell so the
-- glyph sits in optical margin inside the tile (chunky 70% fills read heavy).
-- `opts.name` is a key in SVG_SHAPES (envelope/keyboard/settings/refresh).
-- `opts.color` defaults to primary white. Returns nil if SVG/io is unavailable.
function M.svg_icon(parent, opts)
    opts = opts or {}
    local name = opts.name
    local size = math.floor(tonumber(opts.size) or 48)
    local color = opts.color or M.colors.primary
    local src = ensure_svg_file(name, size, color)
    if not src or type(lvgl.image) ~= "function" then
        return nil
    end
    local ok, img = pcall(lvgl.image, parent, {
        src = src, w = size, h = size,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    return (ok and img) or nil
end

-- Fixed AIODI home grid. Every grid-based home page uses the same 3x4 cells
-- and gutters; page-specific content may choose different spans, but never
-- invents a second coordinate system.
function M.grid(parent, g)
    g = g or M.grid_metrics()
    local grid = lvgl.container(parent, {
        w = g.w, h = g.h,
        bg_opa = 0, border_width = 0, pad = 0,
        pad_row = g.gutter, pad_column = g.gutter,
    })
    grid:set_grid({
        cols = { g.cell, g.cell, g.cell },
        rows = { g.cell, g.cell, g.cell, g.cell },
    })
    grid:set_scroll({ dir = "none", scrollbar = "off" })
    return grid
end

-- Square launcher tile (icon button). `opts.size` sets both edges; `opts.text`
-- is the glyph (use ICONS.*). `opts.accent` overrides the tile fill.
function M.app_icon(parent, opts)
    opts = opts or {}
    local size = opts.size or 88
    opts.size = nil
    local accent = opts.accent
    opts.accent = nil
    local cfg = merged({
        w = size,
        h = size,
        radius = M.radius.md,
        bg_color = accent or M.colors.surface,
        text_color = M.colors.primary,
        shadow_width = 0, -- AIODI is flat; drop the default theme's button shadow
    }, opts)
    return lvgl.button(parent, cfg)
end

-- Widget-grid tile: the outlined rounded surface the AIODI home screen is built
-- from. `opts.col`/`opts.row` are 1-based grid cells; `opts.col_span`/
-- `opts.row_span` default to 1 and the size is derived from grid_metrics(), so
-- callers never hand-compute a spanned width. Pass `opts.on_click` to make the
-- tile tappable -- it then becomes a button, because the binding exposes no way
-- to clear LV_OBJ_FLAG_CLICKABLE and a plain container's clickability is not
-- something to bet the launcher's navigation on.
function M.tile(parent, opts)
    opts = opts or {}
    local g = M.grid_metrics()
    local col, row = opts.col, opts.row
    local cs = opts.col_span or 1
    local rs = opts.row_span or 1
    local on_click = opts.on_click
    opts.col, opts.row, opts.col_span, opts.row_span, opts.on_click =
        nil, nil, nil, nil, nil
    local flex = take_flex(opts)
    local cfg = merged({
        w = cs * g.cell + (cs - 1) * g.gutter,
        h = rs * g.cell + (rs - 1) * g.gutter,
        bg_color = M.colors.surface,
        radius = g.radius,
        border_width = g.stroke,
        border_color = M.colors.stroke,
        pad = 0,
        shadow_width = 0, -- AIODI is flat; drop the default theme's button shadow
    }, opts)
    local tile = on_click and lvgl.button(parent, cfg) or lvgl.container(parent, cfg)
    tile:set_grid_cell({ col = col, row = row, col_span = cs, row_span = rs })
    -- A tile is a card: it never scrolls. LVGL makes a plain container
    -- scrollable by default (lv_button clears the flag, lv_obj does not), so
    -- any child a pixel past the content box would otherwise turn the card
    -- into a scroller with a visible bar -- and only the untappable tiles,
    -- which is worse than uniformly wrong.
    tile:set_scroll({ dir = "none", scrollbar = "off" })
    if flex then
        tile:set_flex(flex)
    end
    if on_click then
        tile:on("clicked", on_click)
    end
    return tile
end

-- List row: full-width rounded surface row (ChatGPT model list, settings, ...).
-- If `opts.text` is given, a caption-weight label is added inside and the row
-- is returned; grab children via the returned handle otherwise.
function M.list_row(parent, opts)
    opts = opts or {}
    local text = opts.text
    opts.text = nil
    local flex = take_flex(opts) or
        { flow = "row", main = "start", cross = "center", track = "center" }
    local cfg = merged({
        h = 64,
        bg_color = M.colors.surface,
        radius = M.radius.md,
        pad = M.space.md,
        pad_column = M.space.sm,
        border_width = 0,
    }, opts)
    local row = lvgl.container(parent, cfg)
    row:set_flex(flex)
    if text then
        lvgl.label(row, { text = text, text_color = M.colors.primary })
    end
    return row
end

-- Centered state placeholder: an optional icon above a caption, for empty/
-- loading/error states. Replaces ad-hoc error captions in the launcher. The box
-- fills the area given by opts.w/opts.h; pass the content column's size.
--   opts.text        caption message
--   opts.icon        SVG_SHAPES key (optional)
--   opts.icon_size   icon px (default 48)
--   opts.color       text + icon colour (set per-state by the wrappers below)
local function state_box(parent, opts, color)
    opts = opts or {}
    color = color or M.colors.secondary
    local box = lvgl.container(parent, {
        w = opts.w, h = opts.h, bg_opa = 0, border_width = 0, pad = 0,
    })
    box:set_scroll({ dir = "none", scrollbar = "off" })
    box:set_flex({ flow = "column", main = "center", cross = "center", track = "center" })
    if opts.icon then
        M.svg_icon(box, { name = opts.icon, size = opts.icon_size or 48, color = color })
    end
    if opts.text then
        M.caption(box, { text = opts.text, align = "center", text_color = color })
    end
    return box
end

--- Empty-state placeholder (secondary grey).
function M.empty(parent, opts)  return state_box(parent, opts, M.colors.secondary) end
--- Loading-state placeholder (secondary grey; spinner pending LVGL anim support).
function M.loading(parent, opts) return state_box(parent, opts, M.colors.secondary) end
--- Error-state placeholder (accent red).
function M.error(parent, opts)  return state_box(parent, opts, M.colors.red) end

-- Full-screen app scaffold: the AIODI black frame + a header row (optional
-- Back button + title) + a padded content column that fills the rest. The
-- Shell mounts this frame either as a child for a source-anchored Hero
-- transition or as a conventional screen when there is no source widget.
-- This is the single source of truth for the OS-shell app frame — the launcher
-- app screens and every generated App use it so they look identical.
--   opts.title   header title text (optional)
--   opts.on_back click handler for a Back button (omit for no back button)
--   opts.main    content main-axis distribution ('start'|'center'|...); default 'start'
--   opts.opa     initial inherited opacity (0 keeps the frame and its children hidden)
-- The Shell may mount this frame beneath a source-anchored Hero surface;
-- the frame itself remains full-screen and is never transformed.
function M.app_frame(parent, opts)
    opts = opts or {}
    local W = _G.WIDTH or 480
    local H = _G.HEIGHT or 800
    local pad = M.space.lg
    local header_h = M.chrome.header_h
    local root = lvgl.container(parent, {
        x = 0, y = 0, w = W, h = H, bg_color = M.colors.bg,
        bg_opa = 255, opa = opts.opa or 255, radius = 0, clip_corner = 1,
        border_width = 0, pad = 0 })
    root:set_scroll({ dir = "none", scrollbar = "off" })
    -- The App frame owns the full display while it is present. Child app
    -- controls still receive taps and empty areas cannot fall through to the
    -- Shell underneath.
    root:set_clickable(true)

    local layout = lvgl.container(root, {
        x = 0, y = 0, w = W, h = H, bg_opa = 0, border_width = 0,
        pad = pad, pad_row = pad })
    layout:set_scroll({ dir = "none", scrollbar = "off" })
    layout:set_flex({ flow = "column", main = "start", cross = "center", track = "center" })
    local bar = lvgl.container(layout, {
        w = W - 2 * pad, h = header_h, bg_opa = 0, border_width = 0, pad = 0,
        pad_column = M.space.md })
    bar:set_scroll({ dir = "none", scrollbar = "off" })
    bar:set_flex({ flow = "row", main = "start", cross = "center", track = "center" })
    if opts.on_back then
        local glyph = (_G.ICONS and _G.ICONS.left) or "<"
        -- Both w and h, always: the binding applies a size only when BOTH are
        -- set, so the h-only button this used to be never got sized at all.
        local back = M.button(bar, { text = glyph .. " Back",
                                      w = M.chrome.back_w, h = M.chrome.back_h })
        back:on("clicked", opts.on_back)
    end
    if opts.title then
        -- Title is pure text (no icons), so default it to the CJK font so
        -- Chinese titles render; English falls back cleanly within the TTF.
        M.title(bar, { text = opts.title, font = M.font(M.text.body) })
    end
    local content = lvgl.container(layout, {
        w = W - 2 * pad, h = H - 2 * pad - header_h - pad, bg_opa = 0,
        border_width = 0, pad = 0, pad_row = M.space.md })
    content:set_flex({ flow = "column", main = opts.main or "start",
        cross = "center", track = "center" })

    return root, content
end

function M.app(opts)
    local scr = M.screen()
    local frame, content = M.app_frame(scr, opts)
    return scr, content
end

-- Pill button. `opts.accent` picks the fill (defaults to the neutral button
-- token); `opts.text` is the label.
function M.button(parent, opts)
    opts = opts or {}
    local accent = opts.accent
    opts.accent = nil
    local cfg = merged({
        radius = M.radius.pill,
        bg_color = accent or M.colors.button,
        text_color = M.colors.primary,
        pad = M.space.sm,
        shadow_width = 0, -- AIODI is flat; drop the default theme's button shadow
    }, opts)
    return lvgl.button(parent, cfg)
end

return M
