-- app_center.lua - App Center UI (Homepage/#3): direct catalog launch.
--
-- Extracted from the launcher. The App Manager owns registration and lifecycle;
-- this module only renders catalog rows and forwards a direct open request.
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local store = require("store")

local NO_SCROLL = { dir = "none", scrollbar = "off" }

local M = {}
-- Live row labels, keyed by catalog id. Page #3 is built once at boot and stays
-- alive, so opening a catalog item can update its state in place.
M.state_lbls = {}

function M.paint_row(id, _is_installed)
    local lbl = M.state_lbls[id]
    if lbl then
        lbl:set_text("Open")
    end
end

local function ensure_catalog_app(cat, ctx)
    local app = ctx.find_app(cat.id)
    if not app then
        app = ctx.add_lua_app({
            id = cat.id, name = cat.name, icon = cat.icon,
            svg = cat.svg, accent = cat.accent, src = cat.src, state_defaults = {} })
    end
    M.paint_row(cat.id)
    return app
end

-- A catalog tap opens immediately. The first tap registers the Lua source in
-- the launcher registry, but there is no intermediate install/selection page.
local function open_catalog(cat, ctx)
    ensure_catalog_app(cat, ctx)
    ctx.open(cat.id)
end

-- Homepage/#3: scrollable catalog of apps that open directly on tap.
-- ctx = { find_app = fn, add_lua_app = fn, open = fn, spaced = fn }
function M.build_page(parent, g, ctx)
    local pad = aiodi.space.lg
    local col = lvgl.container(parent, {
        w = g.w, h = g.h, bg_opa = 0, border_width = 0, pad = pad })
    col:set_scroll({ dir = "ver", scrollbar = "auto" })
    col:set_flex({ flow = "column", main = "start", cross = "center", track = "start" })

    aiodi.caption(col, { text = ctx.spaced("APP CENTER") })
    aiodi.caption(col, { text = #store .. " apps available" })

    local w = g.w - 2 * pad
    for _, cat in ipairs(store) do
        local row = lvgl.button(col, {
            w = w, h = aiodi.px(96),
            bg_color = aiodi.colors.surface, radius = aiodi.radius.md,
            border_width = g.stroke, border_color = aiodi.colors.stroke,
            pad = aiodi.space.md,
            pad_column = aiodi.space.md, shadow_width = 0 })
        row:set_clickable(true)
        row:set_scroll(NO_SCROLL)
        row:set_flex({ flow = "row", main = "start", cross = "center", track = "center" })
        local mark_tile = lvgl.container(row, {
            w = aiodi.px(64), h = aiodi.px(64),
            bg_color = cat.accent or aiodi.colors.button,
            radius = aiodi.radius.md, border_width = 0, pad = 0 })
        mark_tile:set_scroll(NO_SCROLL)
        mark_tile:set_clickable(true)
        mark_tile:set_flex({ flow = "column", main = "center", cross = "center", track = "center" })
        if cat.svg then
            aiodi.svg_icon(mark_tile, { name = cat.svg, size = aiodi.px(32) })
        else
            aiodi.title(mark_tile, { text = cat.icon })
        end
        local info = lvgl.container(row, {
            flex_grow = 1, h = aiodi.px(64), bg_opa = 0, border_width = 0,
            pad = 0, pad_row = aiodi.space.xs })
        info:set_scroll(NO_SCROLL)
        info:set_clickable(true)
        info:set_flex({ flow = "column", main = "center", cross = "start", track = "center" })
        aiodi.title(info, { text = cat.name })
        aiodi.caption(info, { text = "v" .. cat.version .. "  " .. cat.desc })
        M.state_lbls[cat.id] = aiodi.caption(row, {
            text = "Open" })
        local function open_from()
            open_catalog(cat, ctx)
        end
        row:on("clicked", open_from)
        mark_tile:on("clicked", open_from)
        info:on("clicked", open_from)
    end
end

return M
