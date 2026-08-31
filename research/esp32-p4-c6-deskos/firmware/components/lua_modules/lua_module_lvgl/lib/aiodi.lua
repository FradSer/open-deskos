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
M.chrome = {
    header_h = 56,
    back_w = 136,
    back_h = 48,
    back_icon = 20,
    back_icon_x = 14,
}

-- TTFs, relative to the writable data root. `font_path` is CJK-capable but
-- Regular-only; `font_bold_path` is Latin/digits-only but carries the heavy
-- weight the AIODI numerals are drawn in.
M.font_path = "fonts/NotoSansSC-Regular.ttf"
M.font_bold_path = "fonts/Montserrat-Bold.ttf"
M.icon_font_path = "fonts/fa-icons.ttf"  -- FontAwesome 6 subset for launcher/app icons

-- Reference canvas ---------------------------------------------------------
-- The AIODI home screen (Figma `Homepage / #1`, node 4403:4473) is drawn on a
-- 320x480 board. Every number below is measured off that board -- nothing in
-- the widget grid is a device constant. M.px() scales them onto the live
-- panel, so the same composition lands on any resolution.
M.ref = {
    w = 320, h = 480,
    cell = 96, gutter = 16, bar_h = 48, radius = 20, stroke = 2,
    -- Ring widget: the Home countdown needs a generous inner hole so the
    -- complete mm:ss value remains readable on the target TTF renderer.
    -- `mmss_max_hole_ratio` preserves the quiet instrument hierarchy; the
    -- text-layout harness below then measures the target font and shrinks only
    -- if its real "88:88" probe needs more room.
    ring = {
        d = 160,
        inset = 24,
        w = 20,
        mmss_max_hole_ratio = 0.17,
    },
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
    local cache_tag = opts and opts.cache_tag
    local cacheable = not opts or cache_tag ~= nil
    local key = path .. ":" .. size
    if cache_tag then
        key = key .. ":" .. cache_tag
    end
    if cacheable then
        local cached = M._font_cache[key]
        if cached ~= nil then
            return cached or nil
        end
    end
    local cfg = { size = size }
    if opts then
        for k, v in pairs(opts) do
            if k ~= "cache_tag" then
                cfg[k] = v
            end
        end
    end
    local ok, font = pcall(lvgl.font_load, path, cfg)
    local result = (ok and font) or nil
    if cacheable then
        M._font_cache[key] = result or false
    end
    return result
end

function M.clear_font_cache()
    M._font_cache = {}
end

-- Load a CJK-capable TTF font at `size`; returns nil if font loading is
-- unavailable so callers fall back to the inherited default (Montserrat, which
-- carries the ICONS.* glyphs but no CJK). Plain loads are cached; configured
-- loads opt into caching with a stable `cache_tag`.
function M.font(size, opts)
    return font_at(M.font_path, size, opts)
end

-- Bold face, for the AIODI numerals. Latin/digits only -- never pass Chinese
-- text to a label styled with this. nil if the TTF is missing, in which case
-- the caller silently falls back to the inherited default font.
function M.font_bold(size, opts)
    return font_at(M.font_bold_path, size, opts)
end

-- Icon font (FontAwesome 6 Free Solid subset, fa-icons.ttf). SVG icons are
-- unreliable on this build: the LVGL SVG decoder parses and sizes the file
-- correctly, but the software vector path (lv_draw_sw_vector via ThorVG)
-- produces blank output on the P4. The TTF rasterizer is the verified path.
-- `opts.name` is the SVG_SHAPES-style key mapped to a FontAwesome codepoint.
local FA_GLYPHS = {
    mail = 0xF0E0, calendar = 0xF133, events = 0xF133,
    settings = 0xF013, tasks = 0xF046, hourglass = 0xF254, focus = 0xF254,
    bell = 0xF0F3, bolt = 0xF0E7, dice = 0xF522, droplet = 0xF043,
    star = 0xF005, leaf = 0xF06C, habit = 0xF0C2, link = 0xF0C1, radar = 0xF0E7,
    ["arrow-big-left"] = 0xF060, ["caret-left"] = 0xF0D9, ["chevron-down"] = 0xF078,
}

function M.icon_font(size, opts)
    return font_at(M.icon_font_path, size, opts)
end

-- Renders a FontAwesome glyph as a label. Returns the label or nil (missing
-- font/glyph). Size is the font px; glyphs are square (512 em) so a 115 px
-- font yields a ~115 px mark.
function M.icon_label(parent, opts)
    opts = opts or {}
    local glyph = FA_GLYPHS[opts.name]
    if not glyph or type(lvgl.label) ~= "function" then
        return nil
    end
    local font = M.icon_font(opts.size or M.px(48), { cache_size = 8 })
    if not font then
        return nil
    end
    local cfg = {
        text = utf8.char(glyph),
        font = font,
        text_color = opts.color or M.colors.primary,
        text_align = opts.align or "center",
        floating = opts.floating,
    }
    for _, k in ipairs({ "x", "y", "w", "h" }) do
        if opts[k] then cfg[k] = opts[k] end
    end
    local ok, lbl = pcall(lvgl.label, parent, cfg)
    return (ok and lbl) or nil
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

-- Text-layout harness -------------------------------------------------------
--
-- LVGL's target TTF rasterizer can be wider than SDL for the same nominal px
-- size. Fixed boxes must therefore choose a font from measured target glyphs,
-- not from a ratio guessed in the caller. This helper is intentionally used
-- during construction only: it caches each fitted font and never participates
-- in high-frequency text updates or pager frames.
function M.fit_bold_text(opts)
    opts = opts or {}
    local text = opts.text or "88:88"
    local width = math.max(1, math.floor(tonumber(opts.width) or 1))
    local padding = math.max(0, math.floor(tonumber(opts.padding) or 0))
    local available = math.max(1, width - 2 * padding)
    local max_size = math.max(1, math.floor(tonumber(opts.max_size) or M.text.body))
    local min_size = math.max(1, math.min(max_size,
        math.floor(tonumber(opts.min_size) or M.text.caption)))
    local cache_size = math.max(0, math.floor(tonumber(opts.cache_size) or 4))
    local cache_tag = opts.cache_tag or "fit-bold"
    local size = max_size
    local font, measured

    repeat
        font = M.font_bold(size, { cache_size = cache_size, cache_tag = cache_tag })
        measured = font and select(1, font:measure(text)) or 0
        if not font or measured <= available or size <= min_size then
            break
        end
        local scaled = math.floor(size * available / math.max(1, measured))
        size = math.max(min_size, math.min(size - 1, scaled))
    until false

    return {
        font = font,
        size = size,
        width = measured,
        line_height = font and font:line_height() or min_size,
        available_width = available,
    }
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
            small_screen = false,
        }
        if not w and not h then metrics_cache = m end
        return m
    end
    local small_screen = pw <= 320 or ph <= 320
    local paper_color = pw == 400 and ph == 600
    local cols, rows = small_screen and 2 or 3, small_screen and 2 or 4
    local fit = math.min(pw / M.ref.w, ph / M.ref.h)
    local gutter = paper_color and 24 or math.floor(M.ref.gutter * fit + 0.5)
    -- Status bar hugs the top edge: bar height = icon glyph + breathing room
    -- (content is top-aligned in build_status_bar, no vertical dead space).
    local status_h = math.max(40, math.floor((M.ref.bar.icon + 12) * fit + 0.5))
    local peek_min = math.floor(M.ref.peek.strip_min * fit + 0.5)
    local peek_pad = math.floor(M.ref.peek.pad * fit + 0.5)
    -- One gutter between grid and peek, same as between tiles.
    local peek_gap = gutter
    -- Cell fills the full width so the grid touches both screen edges
    -- (no side margins; vertical gaps between status bar / grid / peek stay).
    -- The height constraint no longer shrinks the cell: the leftover column
    -- is absorbed by the peek strip, which may drop below peek_min.
    local safe_inset = paper_color and 24 or 0
    local usable_w = pw - 2 * safe_inset
    local cell = (usable_w - (cols - 1) * gutter) // cols
    local gw = cols * cell + (cols - 1) * gutter
    local gh = rows * cell + (rows - 1) * gutter
    -- Leftover height becomes the peek strip (may be smaller than peek_min
    -- so the grid can sit flush edge-to-edge).
    local peek_h = math.max(0, ph - status_h - gh - peek_gap)
    local m = {
        cols = cols, rows = rows,
        cell = cell,
        cell_w = cell, cell_h = cell,
        safe_inset = safe_inset,
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
        x = safe_inset,
        y = status_h,
        -- Peek sits one gutter below the grid, matching tile spacing.
        peek_y = status_h + gh + peek_gap,
        radius = math.floor(M.ref.radius * fit + 0.5),
        stroke = math.max(1, math.floor(M.ref.stroke * fit + 0.5)),
        small_screen = small_screen,
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
    -- A meter is a passive readout: its boxes must never swallow the tap meant
    -- for an enclosing tile button. The fill below also lacked set_scroll
    -- (lv_obj is scrollable by default), which made it the hit-test target.
    track:set_clickable(false)

    local fill = lvgl.container(track, {
        x = 0, y = 0, w = fill_w, h = h,
        bg_color = opts.fill or M.colors.green,
        radius = 0, border_width = 0, pad = 0 })
    fill:set_scroll({ dir = "none", scrollbar = "off" })
    fill:set_clickable(false)

    local chrome = lvgl.container(track, {
        x = 0, y = 0, w = w, h = h,
        bg_opa = 0, border_width = 0,
        pad_left = pad_x, pad_right = pad_x, pad_top = 0, pad_bottom = 0 })
    chrome:set_scroll({ dir = "none", scrollbar = "off" })
    chrome:set_clickable(false)
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
-- Hero progress ring: the minimal circle-timer language shared by Pomodoro,
-- Year and Quota. A large arc (fitted to the panel width) carries a big value
-- and a small label, both vertically centred inside the ring. Returns
-- { arc, value, label, ring_d, arc_w, box } so the caller can drive angle,
-- colour and text on each tick.
function M.ring_hero(parent, opts)
    opts = opts or {}
    local ring_d = opts.d or M.px(260)
    local arc_w = opts.arc_w or M.px(14)
    local color = opts.color or M.colors.red
    local value_text = opts.value or "0"
    local fit_text = opts.fit_text or value_text
    local label_text = opts.label or ""
    local label_font = opts.label_font or M.font(M.text.body)
    local label_lh = label_font and label_font:line_height() or M.text.body

    local box = lvgl.container(parent, {
        w = ring_d, h = ring_d, bg_opa = 0, border_width = 0, pad = 0 })
    box:set_scroll({ dir = "none", scrollbar = "off" })
    box:set_clickable(false)
    local arc = lvgl.arc(box, {
        x = 0, y = 0, w = ring_d, h = ring_d,
        bg_start_angle = 270, bg_end_angle = 271,
        line_color = color, arc_width = arc_w, interactive = false })
    local fit = M.fit_bold_text({
        text = fit_text, width = ring_d - 2 * arc_w,
        padding = M.px(12), max_size = opts.max_size or M.px(64),
        min_size = opts.min_size or M.px(34) })
    local inner_h = fit.line_height + M.space.sm + label_lh
    local inner_top = (ring_d - inner_h) // 2
    local value = M.clock(box, {
        text = value_text, font = fit.font,
        x = 0, y = inner_top, w = ring_d, h = fit.line_height,
        text_align = "center" })
    local label = M.caption(box, {
        text = label_text, font = label_font,
        x = 0, y = inner_top + fit.line_height + M.space.sm,
        w = ring_d, h = label_lh, text_align = "center" })
    return { arc = arc, value = value, label = label,
             ring_d = ring_d, arc_w = arc_w, box = box }
end

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
-- M.text.display)`; without it the inherited default font is used. Defaults
-- to left-aligned text (the design system's numerals hug the left edge of
-- their flex cell, matching the meter rows' labels); pass `text_align =
-- "center"` (e.g. a full-tile clock) to centre.
function M.clock(parent, opts)
    local cfg = merged({ text = "00:00", text_color = M.colors.primary,
                         text_align = "left" }, opts)
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

-- Tabler Icons FILLED set (viewBox 0 0 24 24, https://github.com/tabler/tabler-icons).
-- Every glyph is one or more solid <path fill="%s">; LVGL's Tiny-1.2 decoder
-- handles arc (A/a), quadratic (Q/q), and multi-subpath paths. Note the filled
-- set has NO wifi/bluetooth/refresh/shuffle/server/store/power/chevron-left —
-- closest filled equivalents are mapped below (radar=wifi, link=bluetooth,
-- bolt=charge, hourglass=pomodoro, stack-2=server, shopping-cart=store,
-- caret-left=back).
local SVG_SHAPES = {
    mail = [[
<path fill="%s" d="M22 7.535v9.465a3 3 0 0 1 -2.824 2.995l-.176 .005h-14a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-9.465l9.445 6.297l.116 .066a1 1 0 0 0 .878 0l.116 -.066l9.445 -6.297z"/>
<path fill="%s" d="M19 4c1.08 0 2.027 .57 2.555 1.427l-9.555 6.37l-9.555 -6.37a2.999 2.999 0 0 1 2.354 -1.42l.201 -.007h14z"/>
]],
    keyboard = [[
<path fill="%s" d="M20 5a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-16a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3zm-14 8a1 1 0 0 0 -1 1v.01a1 1 0 0 0 2 0v-.01a1 1 0 0 0 -1 -1m12 0a1 1 0 0 0 -1 1v.01a1 1 0 0 0 2 0v-.01a1 1 0 0 0 -1 -1m-7.998 0a1 1 0 0 0 -.004 2l4 .01a1 1 0 0 0 .005 -2zm-4.002 -4a1 1 0 0 0 -1 1v.01a1 1 0 0 0 2 0v-.01a1 1 0 0 0 -1 -1m4 0a1 1 0 0 0 -1 1v.01a1 1 0 0 0 2 0v-.01a1 1 0 0 0 -1 -1m4 0a1 1 0 0 0 -1 1v.01a1 1 0 0 0 2 0v-.01a1 1 0 0 0 -1 -1m4 0a1 1 0 0 0 -1 1v.01a1 1 0 0 0 2 0v-.01a1 1 0 0 0 -1 -1"/>
]],
    settings = [[
<path fill="%s" d="M14.647 4.081a.724 .724 0 0 0 1.08 .448c2.439 -1.485 5.23 1.305 3.745 3.744a.724 .724 0 0 0 .447 1.08c2.775 .673 2.775 4.62 0 5.294a.724 .724 0 0 0 -.448 1.08c1.485 2.439 -1.305 5.23 -3.744 3.745a.724 .724 0 0 0 -1.08 .447c-.673 2.775 -4.62 2.775 -5.294 0a.724 .724 0 0 0 -1.08 -.448c-2.439 1.485 -5.23 -1.305 -3.745 -3.744a.724 .724 0 0 0 -.447 -1.08c-2.775 -.673 -2.775 -4.62 0 -5.294a.724 .724 0 0 0 .448 -1.08c-1.485 -2.439 1.305 -5.23 3.744 -3.745a.722 .722 0 0 0 1.08 -.447c.673 -2.775 4.62 -2.775 5.294 0zm-2.647 4.919a3 3 0 1 0 0 6a3 3 0 0 0 0 -6"/>
]],
    calendar = [[
<path fill="%s" d="M16 2a1 1 0 0 1 .993 .883l.007 .117v1h1a3 3 0 0 1 2.995 2.824l.005 .176v12a3 3 0 0 1 -2.824 2.995l-.176 .005h-12a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-12a3 3 0 0 1 2.824 -2.995l.176 -.005h1v-1a1 1 0 0 1 1.993 -.117l.007 .117v1h6v-1a1 1 0 0 1 1 -1zm3 7h-14v9.625c0 .705 .386 1.286 .883 1.366l.117 .009h12c.513 0 .936 -.53 .993 -1.215l.007 -.16v-9.625z"/>
<path fill="%s" d="M12 12a1 1 0 0 1 .993 .883l.007 .117v3a1 1 0 0 1 -1.993 .117l-.007 -.117v-2a1 1 0 0 1 -.117 -1.993l.117 -.007h1z"/>
]],
    clock = [[
<path fill="%s" d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-5 2.66a1 1 0 0 0 -.993 .883l-.007 .117v5l.009 .131a1 1 0 0 0 .197 .477l.087 .1l3 3l.094 .082a1 1 0 0 0 1.226 0l.094 -.083l.083 -.094a1 1 0 0 0 0 -1.226l-.083 -.094l-2.707 -2.708v-4.585l-.007 -.117a1 1 0 0 0 -.993 -.883z"/>
]],
    hourglass = [[
<path fill="%s" d="M17 2a2 2 0 0 1 1.995 1.85l.005 .15v2a6.996 6.996 0 0 1 -3.393 6a6.994 6.994 0 0 1 3.388 5.728l.005 .272v2a2 2 0 0 1 -1.85 1.995l-.15 .005h-10a2 2 0 0 1 -1.995 -1.85l-.005 -.15v-2a6.996 6.996 0 0 1 3.393 -6a6.994 6.994 0 0 1 -3.388 -5.728l-.005 -.272v-2a2 2 0 0 1 1.85 -1.995l.15 -.005h10z"/>
]],
    dice = [[
<path fill="%s" d="M18.333 2c1.96 0 3.56 1.537 3.662 3.472l.005 .195v12.666c0 1.96 -1.537 3.56 -3.472 3.662l-.195 .005h-12.666a3.667 3.667 0 0 1 -3.662 -3.472l-.005 -.195v-12.666c0 -1.96 1.537 -3.56 3.472 -3.662l.195 -.005h12.666zm-2.833 12a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m-7 0a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m0 -7a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3m7 0a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0 -3"/>
]],
    bell = [[
<path fill="%s" d="M14.235 19c.865 0 1.322 1.024 .745 1.668a3.992 3.992 0 0 1 -2.98 1.332a3.992 3.992 0 0 1 -2.98 -1.332c-.552 -.616 -.158 -1.579 .634 -1.661l.11 -.006h4.471z"/>
<path fill="%s" d="M12 2c1.358 0 2.506 .903 2.875 2.141l.046 .171l.008 .043a8.013 8.013 0 0 1 4.024 6.069l.028 .287l.019 .289v2.931l.021 .136a3 3 0 0 0 1.143 1.847l.167 .117l.162 .099c.86 .487 .56 1.766 -.377 1.864l-.116 .006h-16c-1.028 0 -1.387 -1.364 -.493 -1.87a3 3 0 0 0 1.472 -2.063l.021 -.143l.001 -2.97a8 8 0 0 1 3.821 -6.454l.248 -.146l.01 -.043a3.003 3.003 0 0 1 2.562 -2.29l.182 -.017l.176 -.004z"/>
]],
    droplet = [[
<path fill="%s" d="M10.708 2.372a2.382 2.382 0 0 0 -.71 .686l-4.892 7.26c-1.981 3.314 -1.22 7.466 1.767 9.882c2.969 2.402 7.286 2.402 10.254 0c2.987 -2.416 3.748 -6.569 1.795 -9.836l-4.919 -7.306c-.722 -1.075 -2.192 -1.376 -3.295 -.686z"/>
]],
    star = [[
<path fill="%s" d="M8.243 7.34l-6.38 .925l-.113 .023a1 1 0 0 0 -.44 1.684l4.622 4.499l-1.09 6.355l-.013 .11a1 1 0 0 0 1.464 .944l5.706 -3l5.693 3l.1 .046a1 1 0 0 0 1.352 -1.1l-1.091 -6.355l4.624 -4.5l.078 -.085a1 1 0 0 0 -.633 -1.62l-6.38 -.926l-2.852 -5.78a1 1 0 0 0 -1.794 0l-2.853 5.78z"/>
]],
    radar = [[
<path fill="%s" d="M12 10a2 2 0 0 1 1.678 .911l.053 .089h7.269l.117 .007a1 1 0 0 1 .883 .993c0 5.523 -4.477 10 -10 10a1 1 0 0 1 -1 -1v-7.269l-.089 -.053a2 2 0 0 1 -.906 -1.529l-.005 -.149a2 2 0 0 1 2 -2m9.428 -1.334a1 1 0 0 1 -1.884 .668a8 8 0 1 0 -10.207 10.218a1 1 0 0 1 -.666 1.886a10 10 0 1 1 12.757 -12.772m-4.628 -.266a1 1 0 0 1 -1.6 1.2a4 4 0 1 0 -5.6 5.6a1 1 0 0 1 -1.2 1.6a6 6 0 1 1 8.4 -8.4"/>
]],
    apps = [[
<path fill="%s" d="M9 3h-4a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2z"/>
<path fill="%s" d="M9 13h-4a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2z"/>
<path fill="%s" d="M19 13h-4a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2z"/>
<path fill="%s" d="M17 3a1 1 0 0 1 .993 .883l.007 .117v2h2a1 1 0 0 1 .117 1.993l-.117 .007h-2v2a1 1 0 0 1 -1.993 .117l-.007 -.117v-2h-2a1 1 0 0 1 -.117 -1.993l.117 -.007h2v-2a1 1 0 0 1 1 -1z"/>
]],
    plus = [[
<path fill="%s" d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 0 1 0 2h-6v6a1 1 0 0 1 -2 0v-6h-6a1 1 0 0 1 0 -2h6v-6a1 1 0 0 1 1 -1"/>
]],
    pencil = [[
<path fill="%s" d="M12.085 6.5l5.415 5.415l-8.793 8.792a1 1 0 0 1 -.707 .293h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 .293 -.707zm5.406 -2.698a3.828 3.828 0 0 1 1.716 6.405l-.292 .293l-5.415 -5.415l.293 -.292a3.83 3.83 0 0 1 3.698 -.991"/>
]],
    trash = [[
<path fill="%s" d="M20 6a1 1 0 0 1 .117 1.993l-.117 .007h-.081l-.919 11a3 3 0 0 1 -2.824 2.995l-.176 .005h-8c-1.598 0 -2.904 -1.249 -2.992 -2.75l-.005 -.167l-.923 -11.083h-.08a1 1 0 0 1 -.117 -1.993l.117 -.007zm-10 4a1 1 0 0 0 -1 1v6a1 1 0 0 0 2 0v-6a1 1 0 0 0 -1 -1m4 0a1 1 0 0 0 -1 1v6a1 1 0 0 0 2 0v-6a1 1 0 0 0 -1 -1"/>
<path fill="%s" d="M14 2a2 2 0 0 1 2 2a1 1 0 0 1 -1.993 .117l-.007 -.117h-4l-.007 .117a1 1 0 0 1 -1.993 -.117a2 2 0 0 1 1.85 -1.995l.15 -.005z"/>
]],
    database = [[
<path fill="%s" d="M3 15.731c1.968 1.507 5.234 2.269 9 2.269c3.76 0 7.025 -.76 9 -2.252v2.252c0 2.425 -3.895 3.936 -8.693 3.998l-.307 .002c-4.938 0 -9 -1.523 -9 -4z"/>
<path fill="%s" d="M3 9.731c1.968 1.507 5.234 2.269 9 2.269c3.76 0 7.025 -.76 9 -2.252v2.252c0 2.477 -4.062 4 -9 4c-4.798 0 -8.77 -1.438 -8.979 -3.795l-.016 -.101l-.005 -.104z"/>
<path fill="%s" d="M12 2c1.041 0 2.044 .068 2.977 .198l.469 .071q .84 .14 1.586 .348l.44 .131l.075 .024a11 11 0 0 1 .805 .3l.199 .086q .535 .242 .967 .53q .165 .11 .313 .225a3.8 3.8 0 0 1 .669 .668l.091 .128q .07 .105 .129 .211l.07 .139q .163 .35 .2 .73l.01 .211c0 2.477 -4.062 4 -9 4c-4.798 0 -8.77 -1.438 -8.979 -3.795a1 1 0 0 1 -.021 -.205l.005 -.104l.016 -.1c.205 -2.306 4.01 -3.733 8.667 -3.794z"/>
]],
    ["message-circle"] = [[
<path fill="%s" d="M5.821 4.91c3.899 -2.765 9.468 -2.539 13.073 .535c3.667 3.129 4.168 8.238 1.152 11.898c-2.841 3.447 -7.965 4.583 -12.231 2.805l-.233 -.101l-4.374 .931l-.04 .006l-.035 .007h-.018l-.022 .005h-.038l-.033 .004l-.021 -.001l-.023 .001l-.033 -.003h-.035l-.022 -.004l-.022 -.002l-.035 -.007l-.034 -.005l-.016 -.004l-.024 -.005l-.049 -.016l-.024 -.005l-.011 -.005l-.022 -.007l-.045 -.02l-.03 -.012l-.011 -.006l-.014 -.006l-.031 -.018l-.045 -.024l-.016 -.011l-.037 -.026l-.04 -.027l-.002 -.004l-.013 -.009l-.043 -.04l-.025 -.02l-.006 -.007l-.056 -.062l-.013 -.014l-.011 -.014l-.039 -.056l-.014 -.019l-.005 -.01l-.042 -.073l-.007 -.012l-.004 -.008l-.007 -.012l-.014 -.038l-.02 -.042l-.004 -.016l-.004 -.01l-.017 -.061l-.007 -.018l-.002 -.015l-.005 -.019l-.005 -.033l-.008 -.042l-.002 -.031l-.003 -.01v-.016l-.004 -.054l.001 -.036l.001 -.023l.002 -.053l.004 -.025v-.019l.008 -.035l.005 -.034l.005 -.02l.004 -.02l.018 -.06l.003 -.013l1.15 -3.45l-.022 -.037c-2.21 -3.747 -1.209 -8.391 2.413 -11.119z"/>
]],
    send = [[
<path fill="%s" d="M21.864 3.549l-6.454 17.868a1.55 1.55 0 0 1 -1.41 .903a1.54 1.54 0 0 1 -1.394 -.874l-2.88 -5.759zm-1.414 -1.414l-12.139 12.138l-5.728 -2.864a1.55 1.55 0 0 1 -.903 -1.409c0 -.606 .353 -1.157 .981 -1.44z"/>
]],
    ["shopping-cart"] = [[
<path fill="%s" d="M6 2a1 1 0 0 1 .993 .883l.007 .117v1.068l13.071 .935a1 1 0 0 1 .929 1.024l-.01 .114l-1 7a1 1 0 0 1 -.877 .853l-.113 .006h-12v2h10a3 3 0 1 1 -2.995 3.176l-.005 -.176l.005 -.176c.017 -.288 .074 -.564 .166 -.824h-5.342a3 3 0 1 1 -5.824 1.176l-.005 -.176l.005 -.176a3.002 3.002 0 0 1 1.995 -2.654v-12.17h-1a1 1 0 0 1 -.993 -.883l-.007 -.117a1 1 0 0 1 .883 -.993l.117 -.007h2zm0 16a1 1 0 1 0 0 2a1 1 0 0 0 0 -2m11 0a1 1 0 1 0 0 2a1 1 0 0 0 0 -2"/>
]],
    ["stack-2"] = [[
<path fill="%s" d="M20.894 15.553a1 1 0 0 1 -.447 1.341l-8 4a1 1 0 0 1 -.894 0l-8 -4a1 1 0 0 1 .894 -1.788l7.553 3.774l7.554 -3.775a1 1 0 0 1 1.341 .447m0 -4a1 1 0 0 1 -.447 1.341l-8 4a1 1 0 0 1 -.894 0l-8 -4a1 1 0 0 1 .894 -1.788l7.552 3.775l7.554 -3.775a1 1 0 0 1 1.341 .447m-8.887 -8.552q .056 0 .111 .007l.111 .02l.086 .024l.012 .006l.012 .002l.029 .014l.05 .019l.016 .009l.012 .005l8 4a1 1 0 0 1 0 1.788l-8 4a1 1 0 0 1 -.894 0l-8 -4a1 1 0 0 1 0 -1.788l8 -4l.011 -.005l.018 -.01l.078 -.032l.011 -.002l.013 -.006l.086 -.024l.11 -.02l.056 -.005z"/>
]],
    ["arrow-big-left"] = [[
<path fill="%s" d="M9.586 4l-6.586 6.586a2 2 0 0 0 0 2.828l6.586 6.586a2 2 0 0 0 2.18 .434l.145 -.068a2 2 0 0 0 1.089 -1.78v-2.586h7a2 2 0 0 0 2 -2v-4l-.005 -.15a2 2 0 0 0 -1.995 -1.85l-7 -.001v-2.585a2 2 0 0 0 -3.414 -1.414z"/>
]],
    ["caret-left"] = [[
<path fill="%s" d="M13.883 5.007l.058 -.005h.118l.058 .005l.06 .009l.052 .01l.108 .032l.067 .027l.132 .07l.09 .065l.081 .073l.083 .094l.054 .077l.054 .096l.017 .036l.027 .067l.032 .108l.01 .053l.01 .06l.004 .057l.002 .059v12c0 .852 -.986 1.297 -1.623 .783l-.084 -.076l-6 -6a1 1 0 0 1 -.083 -1.32l.083 -.094l6 -6l.094 -.083l.077 -.054l.096 -.054l.036 -.017l.067 -.027l.108 -.032l.053 -.01l.06 -.01z"/>
]],
    quote = [[
<path fill="%s" d="M9 5a2 2 0 0 1 2 2v6c0 3.13 -1.65 5.193 -4.757 5.97a1 1 0 1 1 -.486 -1.94c2.227 -.557 3.243 -1.827 3.243 -4.03v-1h-3a2 2 0 0 1 -1.995 -1.85l-.005 -.15v-3a2 2 0 0 1 2 -2z"/>
<path fill="%s" d="M18 5a2 2 0 0 1 2 2v6c0 3.13 -1.65 5.193 -4.757 5.97a1 1 0 1 1 -.486 -1.94c2.227 -.557 3.243 -1.827 3.243 -4.03v-1h-3a2 2 0 0 1 -1.995 -1.85l-.005 -.15v-3a2 2 0 0 1 2 -2z"/>
]],
    sun = [[
<path fill="%s" d="M12 19a1 1 0 0 1 .993 .883l.007 .117v1a1 1 0 0 1 -1.993 .117l-.007 -.117v-1a1 1 0 0 1 1 -1z"/>
<path fill="%s" d="M18.313 16.91l.094 .083l.7 .7a1 1 0 0 1 -1.32 1.497l-.094 -.083l-.7 -.7a1 1 0 0 1 1.218 -1.567l.102 .07z"/>
<path fill="%s" d="M7.007 16.993a1 1 0 0 1 .083 1.32l-.083 .094l-.7 .7a1 1 0 0 1 -1.497 -1.32l.083 -.094l.7 -.7a1 1 0 0 1 1.414 0z"/>
<path fill="%s" d="M4 11a1 1 0 0 1 .117 1.993l-.117 .007h-1a1 1 0 0 1 -.117 -1.993l.117 -.007h1z"/>
<path fill="%s" d="M21 11a1 1 0 0 1 .117 1.993l-.117 .007h-1a1 1 0 0 1 -.117 -1.993l.117 -.007h1z"/>
<path fill="%s" d="M6.213 4.81l.094 .083l.7 .7a1 1 0 0 1 -1.32 1.497l-.094 -.083l-.7 -.7a1 1 0 0 1 1.217 -1.567l.102 .07z"/>
<path fill="%s" d="M19.107 4.893a1 1 0 0 1 .083 1.32l-.083 .094l-.7 .7a1 1 0 0 1 -1.497 -1.32l.083 -.094l.7 -.7a1 1 0 0 1 1.414 0z"/>
<path fill="%s" d="M12 2a1 1 0 0 1 .993 .883l.007 .117v1a1 1 0 0 1 -1.993 .117l-.007 -.117v-1a1 1 0 0 1 1 -1z"/>
<path fill="%s" d="M12 7a5 5 0 1 1 -4.995 5.217l-.005 -.217l.005 -.217a5 5 0 0 1 4.995 -4.783z"/>
]],
    moon = [[
<path fill="%s" d="M12 1.992a10 10 0 1 0 9.236 13.838c.341 -.82 -.476 -1.644 -1.298 -1.31a6.5 6.5 0 0 1 -6.864 -10.787l.077 -.08c.551 -.63 .113 -1.653 -.758 -1.653h-.266l-.068 -.006l-.06 -.002z"/>
]],
    leaf = [[
<path fill="%s" d="M3.055 14.328l-.018 -.168l-.004 -.043a11 11 0 0 1 -.047 -1.12c.018 -6.29 4.29 -9.997 13 -9.997h4.014a1 1 0 0 1 1 1l-.002 2.057c-.498 8.701 -4.74 12.943 -11.998 12.943h-2.631a16 16 0 0 0 -.375 2.11a1 1 0 1 1 -1.988 -.22q .174 -1.568 .58 -2.947l-.118 -.146l-.208 -.28l-.157 -.229l-.182 -.293l-.098 -.171l-.065 -.122a6 6 0 0 1 -.397 -.941l-.072 -.237l-.085 -.327l-.057 -.268l-.043 -.242zm8.539 -4.242c-2.845 1.265 -4.854 3.13 -6.108 5.583q .098 .2 .218 .4l.185 .281l.07 .097q .12 .164 .258 .329l.197 .224h.649c1.037 -2.271 2.777 -3.946 5.343 -5.086a1 1 0 0 0 -.812 -1.828"/>
]],
    flame = [[
<path fill="%s" d="M10 2c0 -.88 1.056 -1.331 1.692 -.722c1.958 1.876 3.096 5.995 1.75 9.12l-.08 .174l.012 .003c.625 .133 1.203 -.43 2.303 -2.173l.14 -.224a1 1 0 0 1 1.582 -.153c1.334 1.435 2.601 4.377 2.601 6.27c0 4.265 -3.591 7.705 -8 7.705s-8 -3.44 -8 -7.706c0 -2.252 1.022 -4.716 2.632 -6.301l.605 -.589c.241 -.236 .434 -.43 .618 -.624c1.43 -1.512 2.145 -2.924 2.145 -4.78"/>
]],
    graph = [[
<path fill="%s" d="M18 3a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12zm-2.293 6.293a1 1 0 0 0 -1.414 0l-2.293 2.292l-1.293 -1.292a1 1 0 0 0 -1.414 0l-3 3a1 1 0 0 0 0 1.414l.094 .083a1 1 0 0 0 1.32 -.083l2.293 -2.292l1.293 1.292l.094 .083a1 1 0 0 0 1.32 -.083l2.293 -2.292l1.293 1.292a1 1 0 0 0 1.414 -1.414l-2 -2z"/>
]],
    sparkles = [[
<path fill="%s" d="M16 19a1 1 0 0 1 0 -2a1 1 0 0 0 1 -1c0 -1.333 2 -1.333 2 0a1 1 0 0 0 1 1c1.333 0 1.333 2 0 2a1 1 0 0 0 -1 1c0 1.333 -2 1.333 -2 0a1 1 0 0 0 -1 -1"/>
<path fill="%s" d="M3 11a5 5 0 0 0 5 -5c0 -1.333 2 -1.333 2 0a5 5 0 0 0 5 5c1.333 0 1.333 2 0 2a5 5 0 0 0 -5 5a1 1 0 0 1 -2 0a5 5 0 0 0 -5 -5c-1.333 0 -1.333 -2 0 -2"/>
<path fill="%s" d="M16 7a1 1 0 0 1 0 -2a1 1 0 0 0 1 -1c0 -1.333 2 -1.333 2 0a1 1 0 0 0 1 1c1.333 0 1.333 2 0 2a1 1 0 0 0 -1 1c0 1.333 -2 1.333 -2 0a1 1 0 0 0 -1 -1"/>
]],
    dots = [[
<path fill="%s" d="M7 12a2 2 0 1 1 -4 0q 0 -.053 .005 -.102a1.996 1.996 0 0 1 1.995 -1.898a2 2 0 0 1 2 2"/>
<path fill="%s" d="M14 12a2 2 0 1 1 -4 0q 0 -.053 .005 -.102a1.996 1.996 0 0 1 1.995 -1.898a2 2 0 0 1 2 2"/>
<path fill="%s" d="M21 12a2 2 0 1 1 -4 0q 0 -.053 .005 -.102a1.996 1.996 0 0 1 1.995 -1.898a2 2 0 0 1 2 2"/>
]],
    ["circle-dot"] = [[
<path fill="%s" d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-5 6.66a2 2 0 0 0 -1.977 1.697l-.018 .154l-.005 .149l.005 .15a2 2 0 1 0 1.995 -2.15z"/>
]],
    ["square-dot"] = [[
<path fill="%s" d="M19 2a3 3 0 0 1 3 3v14a3 3 0 0 1 -3 3h-14a3 3 0 0 1 -3 -3v-14a3 3 0 0 1 3 -3zm-7 8a2 2 0 0 0 -1.995 1.85l-.005 .15l.005 .15a2 2 0 1 0 1.995 -2.15z"/>
]],
    bolt = [[
<path fill="%s" d="M13 2l.018 .001l.016 .001l.083 .005l.011 .002h.011l.038 .009l.052 .008l.016 .006l.011 .001l.029 .011l.052 .014l.019 .009l.015 .004l.028 .014l.04 .017l.021 .012l.022 .01l.023 .015l.031 .017l.034 .024l.018 .011l.013 .012l.024 .017l.038 .034l.022 .017l.008 .01l.014 .012l.036 .041l.026 .027l.006 .009c.12 .147 .196 .322 .218 .513l.001 .012l.002 .041l.004 .064v6h5a1 1 0 0 1 .868 1.497l-.06 .091l-8 11c-.568 .783 -1.808 .38 -1.808 -.588v-6h-5a1 1 0 0 1 -.868 -1.497l.06 -.091l8 -11l.01 -.013l.018 -.024l.033 -.038l.018 -.022l.009 -.008l.013 -.014l.04 -.036l.028 -.026l.008 -.006a1 1 0 0 1 .402 -.199l.011 -.001l.027 -.005l.074 -.013l.011 -.001l.041 -.002z"/>
]],
    link = [[
<path fill="%s" d="M15.707 8.293a1 1 0 0 1 0 1.414l-6 6a1 1 0 1 1 -1.414 -1.414l6 -6a1 1 0 0 1 1.414 0"/>
<path fill="%s" d="M19.242 4.757c2.343 2.344 2.342 6.143 -.052 8.534l-.534 .464a1 1 0 1 1 -1.312 -1.51l.483 -.416a4 4 0 0 0 0 -5.657c-1.562 -1.563 -4.095 -1.563 -5.607 -.054l-.463 .536a1 1 0 1 1 -1.514 -1.308l.513 -.59a6 6 0 0 1 8.486 .001"/>
<path fill="%s" d="M6.75 10.338a1 1 0 0 1 -.088 1.411l-.483 .425a3.97 3.97 0 0 0 0 5.649a4.064 4.064 0 0 0 5.678 .038l.34 -.458a1 1 0 1 1 1.606 1.194l-.397 .534l-.1 .114a6.07 6.07 0 0 1 -8.533 0a5.97 5.97 0 0 1 -1.773 -4.247c0 -1.595 .638 -3.124 1.814 -4.284l.524 -.463a1 1 0 0 1 1.411 .087"/>
]],
    lungs = [[
<path fill="%s" d="M12 3a1 1 0 0 1 1 1v5a2 2 0 0 0 1 1.732v-3.475c0 -1.242 .995 -2.257 2.233 -2.257c.372 0 .738 .094 1.122 .307l.18 .117c1.695 1.23 2.76 3.035 3.773 6.34q .674 2.204 .692 5.06c.016 2.195 -1.657 4.024 -3.843 4.168l-.237 .008c-2.17 0 -3.92 -1.787 -3.92 -3.98v-4.146a4 4 0 0 1 -1.893 -1.112l-.107 -.118l-.107 .118a4 4 0 0 1 -1.892 1.112l-.001 4.146c0 2.193 -1.75 3.98 -3.919 3.98l-.268 -.01c-2.155 -.142 -3.827 -1.971 -3.811 -4.165q .018 -2.858 .692 -5.06c1.011 -3.307 2.076 -5.112 3.822 -6.375l.188 -.117a2.2 2.2 0 0 1 1.064 -.273c1.237 0 2.232 1.015 2.232 2.257l.001 3.475a2 2 0 0 0 .999 -1.732v-5a1 1 0 0 1 1 -1"/>
]],
    battery = [[
<path fill="%s" d="M17 6a3 3 0 0 1 2.995 2.824l.005 .176v.086l.052 .019a1.5 1.5 0 0 1 .941 1.25l.007 .145v3a1.5 1.5 0 0 1 -.948 1.395l-.052 .018v.087a3 3 0 0 1 -2.824 2.995l-.176 .005h-11a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-6a3 3 0 0 1 2.824 -2.995l.176 -.005h11z"/>
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
    -- LVGL's SVG decoder sizes from the viewport (width/height) and scales
    -- the artwork via viewBox. Earlier we baked scale into <g transform>
    -- instead, but the on-device lv_svg parser ignores group transforms, so
    -- the 24-unit artwork rendered at its raw size in the corner of the
    -- 115px canvas (invisible). viewBox="0 0 24 24" is the supported path:
    -- lv_svg_render computes scale = width / viewBox_w and applies it.
    return string.format(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 24 24">%s</svg>\n',
        size, size, inner)
end

local function ensure_svg_file(name, size, color)
    local rel = string.format("icons/%s_%d.svg", name, size)
    local doc = svg_document(name, size, color)
    if not doc then
        return nil
    end
    -- Device: DATA_ROOT (storage partition) is set by odk_voice_ui so the
    -- C-stdio write lands in the same tree the LVGL D: drive reads from.
    -- Sim: DATA_ROOT is nil, so keep the legacy relative path (sim cwd).
    local abs = DATA_ROOT and (DATA_ROOT .. "/" .. rel) or rel
    local f = io and io.open(abs, "r")
    local existing = f and f:read("*a") or nil
    if f then
        f:close()
    end
    if existing ~= doc then
        f = io and io.open(abs, "w")
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
        x = opts.x, y = opts.y,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    return (ok and img) or nil
end

-- Brand marks: fixed multi-colour logos (not the single-colour Tabler set).
-- The opencode watermark is the only consumer today; the logo is two solid
-- rectangles (light panel #F1ECEC + dark band #4B4646) on a 240×300 canvas.
--
-- They are drawn as plain stacked LVGL containers, NOT SVG files: this
-- LVGL/ThorVG build renders only the LAST <path> of a multi-path SVG (verified
-- in the SDL sim — a two-path opencode SVG lost the light panel entirely, and
-- swapping order lost the dark band), so any multi-colour SVG mark silently
-- degrades to one colour. Two single-rect containers always render, and they
-- cost no file I/O. `opts.size` is the rendered HEIGHT in px.
local BRAND_VIEWBOX_H = 300
local BRAND_VIEWBOX_W = 240

-- Each brand is a list of {fill, x, y, w, h} rects in 240×300 viewBox units,
-- drawn bottom-up in list order (later rects paint on top).
local BRAND_SHAPES = {
    opencode = {
        { fill = "#F1ECEC", x = 0,  y = 0,   w = 240, h = 300 },
        { fill = "#4B4646", x = 60, y = 120, w = 120, h = 120 },
    },
}

-- Renders a fixed-colour brand mark (opencode) at `size` px tall. Returns the
-- base lvgl.container widget (the whole-canvas bottom rect) or nil; any
-- overlaid rects are attached as floating children so they move with the base
-- and paint on top. Callers set floating + set_pos to place the returned base.
function M.brand_icon(parent, opts)
    opts = opts or {}
    local name = opts.name or "opencode"
    local size = math.floor(tonumber(opts.size) or 96)
    local shapes = BRAND_SHAPES[name]
    if not shapes or type(lvgl.container) ~= "function" then
        return nil
    end
    local s = size / BRAND_VIEWBOX_H
    local out_w = math.max(1, math.floor(size * BRAND_VIEWBOX_W / BRAND_VIEWBOX_H + 0.5))
    local base = shapes[1]
    local ok, img = pcall(lvgl.container, parent, {
        w = out_w, h = size,
        bg_opa = 255,
        radius = 0, border_width = 0, pad = 0,
    })
    if not (ok and img) then
        return nil
    end
    -- create-opts do NOT apply bg_color (common opts only set size/pos) — it
    -- must go through set_style. Without this the base canvas never paints.
    img:set_style({ bg_color = base.fill, bg_opa = 255 })
    img:set_scroll({ dir = "none", scrollbar = "off" })
    img:set_clickable(false)
    for i = 2, #shapes do
        local sh = shapes[i]
        local bw = math.max(1, math.floor(sh.w * s + 0.5))
        local bh = math.max(1, math.floor(sh.h * s + 0.5))
        local bx = math.floor(sh.x * s + 0.5)
        local by = math.floor(sh.y * s + 0.5)
        local okb, band = pcall(lvgl.container, img, {
            w = bw, h = bh,
            bg_opa = 255,
            radius = 0, border_width = 0, pad = 0,
        })
        if okb and band then
            band:set_style({ bg_color = sh.fill, bg_opa = 255 })
            band:set_style({ floating = true })
            band:set_pos(bx, by)
            band:set_clickable(false)
        end
    end
    return img
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
    local cols = {}
    local rows = {}
    for _ = 1, g.cols do cols[#cols + 1] = g.cell end
    for _ = 1, g.rows do rows[#rows + 1] = g.cell end
    grid:set_grid({ cols = cols, rows = rows })
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
    local pad = 0 -- edge-to-edge: no side margins (2026-08-12, all elements flush)
    -- Top dismiss hot zone: taller than the visible capsule so the whole
    -- banner area (full width, plus a modest column below the pill) is
    -- tappable. Content starts below it. Sized ~1.5x the capsule (48px) so
    -- the invisible band does not push content down; a taller value was
    -- leaving a large dead band above every app's content.
    local hit_h = M.px(56)
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
        w = W - 2 * pad, h = hit_h, bg_opa = 0, border_width = 0, pad = 0,
        pad_column = M.space.md })
    bar:set_scroll({ dir = "none", scrollbar = "off" })
    bar:set_flex({ flow = "row", main = "start", cross = "center", track = "center" })
    if opts.on_back then
        -- Fixed child frames avoid flex/content-size variance between the SDL
        -- and target renderers. The Tabler filled arrow has its own leading
        -- lane while the wordmark remains geometrically centred in the whole
        -- touch target.
        local back = M.button(bar, {
            w = M.chrome.back_w,
            h = M.chrome.back_h,
            pressed_bg_opa = 176,
        })
        local icon = M.svg_icon(back, {
            name = "arrow-big-left",
            size = M.chrome.back_icon,
            color = M.colors.primary,
        })
        if icon then
            icon:set_pos(M.chrome.back_icon_x,
                (M.chrome.back_h - M.chrome.back_icon) // 2)
        end
        local back_font = opts.font or M.font(M.text.body)
        local back_line_h = math.min(M.chrome.back_h,
            back_font and back_font:line_height() or M.text.body)
        M.title(back, {
            x = 0,
            y = (M.chrome.back_h - back_line_h) // 2,
            w = M.chrome.back_w,
            h = back_line_h,
            text = "Back", font = back_font, text_align = "center",
        })
        back:on("clicked", opts.on_back)
    end
    -- No centered title: the top handle (below) replaces it. Single-page apps
    -- have no Back button either (opts.on_back is only set by apps that
    -- opt into in-app sub-page navigation).
    local content = lvgl.container(layout, {
        w = W - 2 * pad, h = H - hit_h, bg_opa = 0,
        border_width = 0, pad = 0, pad_row = M.space.md })
    -- Vertical elastic scroll surface: pulling down on the app content (or the
    -- top handle) overscrolls past the top edge; crossing the threshold
    -- dismisses the app (sheet-style drag-to-close). Elastic lets a
    -- shorter-than-viewport screen still produce a pull gesture.
    content:set_scroll({ dir = "ver", scrollbar = "off", elastic = true })
    content:set_flex({ flow = "column", main = opts.main or "start",
        cross = "center", track = "center" })
    if opts.on_dismiss then
        local dismissed = false
        content:on("scroll", function()
            if dismissed then return end
            local _, sy = content:get_scroll()
            if sy < -60 then
                dismissed = true
                opts.on_dismiss()
            end
        end)
    end

    -- Top dismiss handle: a single wide rounded bar centered at the very top.
    -- Deliberately distinct from the home page-dot pager (3 small pills): this
    -- is one wide, low-contrast bar. Tapping (or, later, dragging it down)
    -- dismisses the app via opts.on_dismiss; the Back button (opts.on_back)
    -- stays reserved for in-app sub-page navigation.
    if opts.on_dismiss or opts.on_back then
        -- Top dismiss hot zone: full-width strip (hit_h tall) so the whole
        -- banner area is tappable — not just the visible capsule. The capsule
        -- (grey pill + white inner pill, same language as the page-dot pager)
        -- sits inside it for the visual grab affordance.
        local hit = lvgl.container(root, {
            x = 0, y = 0, w = W, h = hit_h,
            bg_opa = 0, border_width = 0, pad = 0 })
        hit:set_scroll({ dir = "none", scrollbar = "off" })
        -- Transparent containers are not clickable by default in LVGL; the
        -- whole banner must receive taps.
        hit:set_clickable(true)
        hit:on("clicked", opts.on_dismiss or opts.on_back)

        local hw, hh = M.chrome.back_w, M.chrome.back_h
        local handle = lvgl.container(hit, {
            x = (W - hw) // 2, y = M.px(6),
            w = hw, h = hh,
            bg_color = M.colors.button,
            radius = M.radius.pill,
            border_width = 0, pad = 0 })
        handle:set_scroll({ dir = "none", scrollbar = "off" })
        -- Visual-only: the capsule must not swallow taps meant for the hot
        -- zone beneath it.
        handle:set_clickable(false)
        local inner_w, inner_h = M.px(32), M.px(6)
        local inner = lvgl.container(handle, {
            x = (hw - inner_w) // 2, y = (hh - inner_h) // 2,
            w = inner_w, h = inner_h,
            bg_color = M.colors.primary,
            radius = M.radius.pill,
            border_width = 0, pad = 0 })
        inner:set_scroll({ dir = "none", scrollbar = "off" })
        inner:set_clickable(false)
    end

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
        -- Native pressed opacity gives immediate touch acknowledgement without
        -- the theme's geometry-changing press transform.
        pressed_bg_opa = 176,
        text_color = M.colors.primary,
        pad = M.space.sm,
        shadow_width = 0, -- AIODI is flat; drop the default theme's button shadow
    }, opts)
    return lvgl.button(parent, cfg)
end

function M.label(parent, opts)
    opts = opts or {}
    local text = opts.text or ""
    local lbl = lvgl.label(parent, {
        text = text,
        font = opts.font,
        text_color = opts.color or opts.text_color,
        text_align = opts.text_align,
        x = opts.x,
        y = opts.y,
        w = opts.w,
        h = opts.h,
        align = opts.align,
    })
    local style = {}
    if opts.font then style.font = opts.font end
    if opts.color or opts.text_color then style.text_color = opts.color or opts.text_color end
    if opts.text_align then style.text_align = opts.text_align end
    if next(style) ~= nil then
        lbl:set_style(style)
    end
    return lbl
end

function M.pill_button(parent, opts)
    opts = opts or {}
    local text = opts.text or ""
    local w = opts.w or M.px(80)
    local h = opts.h or M.px(40)
    local bg_color = opts.bg_color or opts.accent or M.colors.button
    local radius = opts.radius or M.radius.pill
    local font = opts.font or M.font_bold(M.px(16))
    local text_color = opts.text_color or M.colors.primary

    local btn = lvgl.button(parent, {
        x = opts.x,
        y = opts.y,
        w = w,
        h = h,
        bg_color = bg_color,
        radius = radius,
        border_width = 0,
        pad = 0,
    })
    btn:set_flex({ flow = "row", main = "center", cross = "center" })

    local lbl = lvgl.label(btn, {
        text = text,
        font = font,
        text_color = text_color,
    })
    lbl:set_style({
        text_color = text_color,
        font = font,
    })

    return btn
end

M.ring = M.ring_hero

--- Letter-spacing: insert spaces between characters for visual readout.
-- @param s string: Input string
-- @return string: Spaced string ("ABC" → "A B C")
function M.spaced(s)
    if type(s) ~= "string" then return tostring(s or "") end
    return s:gsub("(.)", "%1 "):gsub(" $", "")
end

return M
