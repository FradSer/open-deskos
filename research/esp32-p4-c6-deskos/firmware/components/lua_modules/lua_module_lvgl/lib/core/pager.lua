--
-- core/pager.lua -- Open DeskOS Dual-Surface Snapshot Pager & Gesture Manager
--
-- Implements the high-performance 60 FPS snapshot scrolling architecture:
--   1. Live Widget Layer: Interactive widgets inside floating input_overlay slots.
--   2. Moving Snapshot Layer: Pre-rendered RGB565 bitmaps (via lv_snapshot_take).
--   3. Drag Overlay Layer: Shallow live widgets traveling above moving bitmaps.
--   4. Native C Hook: Armed via pages:set_scroll_snapshot_layers() for zero-lag
--      bitmap blits during drag and native status-bar indicator interpolation.
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local M = {}

local NO_SCROLL = { dir = "none", scrollbar = "off" }
local PAGER_SNAP_SETTLE_MS = 180

local pager = {
    pages_scroller = nil,   -- Root scroll container (g.w x g.h)
    page_slot_w = 0,        -- g.w + g.gutter
    page_count = 4,
    current_page = 1,
    page_tiles = {},        -- Live slots inside input_overlay [1..N]
    page_imgs = {},         -- Snapshot img_holders inside wraps [1..N]
    page_snapshots = {},    -- Snapshot image objects [1..N]
    page_wraps = {},        -- Moving horizontal slot wrappers [1..N]
    page_drag_layers = {},  -- Shallow drag overlays [1..N]
    page_input_guards = {}, -- Touch guards for inactive pages [1..N]
    page_dots = {},         -- Status bar dot objects [1..N]
    page_pager = nil,       -- Status bar pager container
    dot_idle = 12,
    dot_active_w = 28,
    page_hit_w = 30,
    native_hook_armed = false,
    on_page_changed = nil,  -- callback(page_idx)
}

local function layout_page_markers(widths)
    local total = 0
    local count = #widths
    local b = aiodi.ref.bar
    local gap = math.floor(aiodi.px(b.dot_gap))
    for i = 1, count do
        total = total + widths[i]
    end
    if count > 1 then
        total = total + (count - 1) * gap
    end

    local W = _G.WIDTH or 480
    local start_x = math.floor((W - total) / 2)
    local cur_x = start_x
    local rects = {}
    for i = 1, count do
        rects[i] = { x = cur_x, w = widths[i] }
        cur_x = cur_x + widths[i] + gap
    end
    return rects
end

function M.paint_page_dots(n)
    n = math.max(1, math.min(pager.page_count, n or pager.current_page))
    pager.current_page = n

    local count = pager.page_count
    if count <= 0 or not pager.page_dots or #pager.page_dots == 0 then
        return
    end

    local g = aiodi.grid_metrics()
    local dot_d = pager.dot_idle
    local dot_active_w = pager.dot_active_w

    local widths = {}
    for i = 1, count do
        widths[i] = (i == n) and dot_active_w or dot_d
    end

    local rects = layout_page_markers(widths)
    for i = 1, count do
        local obj = pager.page_dots[i]
        if obj then
            local r = rects[i]
            obj:set_pos(r.x, math.floor((g.status_h - dot_d) / 2))
            obj:set_size(r.w, dot_d)
            obj:set_style({
                bg_color = (i == n) and aiodi.colors.primary or aiodi.colors.button,
                radius = aiodi.radius.pill,
            })
        end
    end

    if type(pager.on_page_changed) == "function" then
        pcall(pager.on_page_changed, n)
    end
end

function M.page_from_scroll()
    if not pager.pages_scroller or type(pager.pages_scroller.get_scroll) ~= "function" then
        return pager.current_page
    end
    local x = select(1, pager.pages_scroller:get_scroll())
    local slot = pager.page_slot_w or 1
    local n = math.floor((x + slot / 2) / slot) + 1
    if n < 1 then
        n = 1
    elseif n > pager.page_count then
        n = pager.page_count
    end
    return n
end

function M.go_page(n, anim)
    n = math.max(1, math.min(pager.page_count, n or 1))
    if not pager.pages_scroller then
        return
    end

    if anim == false then
        M.paint_page_dots(n)
    end

    local slot = pager.page_slot_w or 0
    if type(pager.pages_scroller.scroll_to) == "function" then
        pager.pages_scroller:scroll_to((n - 1) * slot, 0, anim ~= false)
    end
end

function M.refresh_page_snapshot(page_idx)
    page_idx = page_idx or pager.current_page
    if not pager.page_tiles or not pager.page_imgs or type(lvgl.snapshot_take) ~= "function" then
        return false
    end

    local slot = pager.page_tiles[page_idx]
    local img_holder = pager.page_imgs[page_idx]
    if not slot or not img_holder then
        return false
    end

    local g = aiodi.grid_metrics()
    local previous = pager.page_snapshots[page_idx]
    local taken, img = pcall(lvgl.snapshot_take, slot, img_holder)
    if not taken or not img then
        return false
    end

    img:set_size(g.w, g.h)
    img:set_pos(0, 0)
    img:set_clickable(false)
    img:set_scroll(NO_SCROLL)
    pager.page_snapshots[page_idx] = img

    if previous then
        pcall(function() previous:delete() end)
    end

    return true
end

function M.prepare_page_snapshots()
    if not pager.pages_scroller or not pager.page_tiles or not pager.page_imgs then
        return false
    end

    print("[snapshot] pre-rendering page snapshots")
    local ok = true
    for i = 1, pager.page_count do
        if not M.refresh_page_snapshot(i) then
            ok = false
        end
    end

    if ok and type(pager.pages_scroller.set_scroll_snapshot_layers) == "function" then
        local hook_ok = pcall(function()
            return pager.pages_scroller:set_scroll_snapshot_layers({
                live = pager.page_tiles,
                snapshots = pager.page_imgs,
                overlays = pager.page_drag_layers,
                page_width = pager.page_slot_w,
                page_indicators = {
                    dots = pager.page_dots,
                    pager = pager.page_pager,
                    hit_width = pager.page_hit_w,
                    idle_width = pager.dot_idle,
                    active_width = pager.dot_active_w,
                    height = pager.dot_idle,
                    active_color = aiodi.colors.primary,
                    idle_color = aiodi.colors.button,
                },
            })
        end)

        if hook_ok then
            pager.native_hook_armed = true
            print("[snapshot] native scroll hook armed")
        else
            print("[snapshot] native scroll hook failed to arm")
        end
    end

    return ok
end

function M.on_scroll_end()
    local settled_page = M.page_from_scroll()
    pager.current_page = settled_page
    if not pager.native_hook_armed then
        M.paint_page_dots(settled_page)
    end
end

--- Create the dual-surface snapshot pager architecture.
-- @param scr lvgl_obj: Root screen
-- @param page_count integer: Number of pages (e.g. 4)
-- @param dots_parent lvgl_obj: Status bar container for indicator dots
-- @return lvgl_obj, table: Scroller container, list of live interactive page slots
function M.create(scr, page_count, dots_parent)
    local g = aiodi.grid_metrics()
    page_count = math.max(1, page_count or 4)

    pager.page_count = page_count
    pager.current_page = 1
    pager.page_slot_w = g.w + g.gutter
    pager.page_tiles = {}
    pager.page_imgs = {}
    pager.page_snapshots = {}
    pager.page_wraps = {}
    pager.page_drag_layers = {}
    pager.page_input_guards = {}
    pager.page_dots = {}

    -- 1. Horizontal scroller: snap-scroll across page slots
    local pages = lvgl.container(scr, {
        x = g.x, y = g.y, w = g.w, h = g.h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    pages:set_scroll({
        dir = "hor",
        scrollbar = "off",
        snap_x = "center",
        elastic = false,
        momentum = true,
        scroll_one = true,
        snap_anim_ms = PAGER_SNAP_SETTLE_MS,
    })
    pager.pages_scroller = pages

    -- 2. Create moving snapshot wrappers & drag layers
    for i = 1, page_count do
        local wrap = lvgl.container(pages, {
            x = (i - 1) * pager.page_slot_w, y = 0, w = g.w, h = g.h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        wrap:set_scroll(NO_SCROLL)
        wrap:set_clickable(false)

        local img_holder = lvgl.container(wrap, {
            w = g.w, h = g.h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        img_holder:set_pos(0, 0)
        img_holder:set_scroll(NO_SCROLL)
        img_holder:set_clickable(false)
        img_holder:set_style({ opa_layered = 0 })

        local drag_layer = lvgl.container(wrap, {
            x = 0, y = 0, w = g.w, h = g.h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        drag_layer:set_scroll(NO_SCROLL)
        drag_layer:set_clickable(false)
        drag_layer:set_style({ opa_layered = 0 })

        pager.page_wraps[i] = wrap
        pager.page_imgs[i] = img_holder
        pager.page_drag_layers[i] = drag_layer
    end

    -- 3. Floating input overlay holding live interactive page slots
    local input_overlay = lvgl.container(pages, {
        x = 0, y = 0, w = g.w, h = g.h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    input_overlay:set_scroll(NO_SCROLL)
    input_overlay:set_clickable(false)
    input_overlay:set_style({ floating = true })

    for i = 1, page_count do
        local slot = lvgl.container(input_overlay, {
            w = g.w, h = g.h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        slot:set_pos(0, 0)
        slot:set_scroll(NO_SCROLL)
        slot:set_clickable(false)

        local input_guard = lvgl.container(slot, {
            x = 0, y = 0, w = g.w, h = g.h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        input_guard:set_scroll(NO_SCROLL)
        input_guard:set_clickable(true)

        pager.page_tiles[i] = slot
        pager.page_input_guards[i] = input_guard
    end

    -- 4. Setup status bar indicator dots
    if dots_parent then
        local b = aiodi.ref.bar
        local dot = math.floor(aiodi.px(b.dot))
        local dot_active_w = math.floor(aiodi.px(b.dot_active))
        local hit_w = math.max(math.floor(aiodi.px(b.dot_hit)), dot_active_w)
        local pager_w = page_count * hit_w

        pager.dot_idle = dot
        pager.dot_active_w = dot_active_w
        pager.page_hit_w = hit_w
        pager.page_pager = dots_parent

        for i = 1, page_count do
            local hit = lvgl.button(dots_parent, {
                x = (i - 1) * hit_w, y = 0,
                w = hit_w, h = g.status_h,
                bg_opa = 0, border_width = 0, pad = 0, shadow_width = 0,
            })
            hit:set_scroll(NO_SCROLL)

            local d = lvgl.container(hit, {
                x = (hit_w - ((i == 1) and dot_active_w or dot)) // 2,
                y = math.floor((g.status_h - dot) / 2),
                w = (i == 1) and dot_active_w or dot,
                h = dot,
                bg_color = (i == 1) and aiodi.colors.primary or aiodi.colors.button,
                radius = aiodi.radius.pill,
                border_width = 0, pad = 0,
            })
            d:set_scroll(NO_SCROLL)
            d:set_clickable(false)
            pager.page_dots[i] = d

            hit:on("clicked", function()
                M.go_page(i, true)
            end)
        end
    end

    -- 5. Attach scroll_end handler
    pages:on("scroll_end", function()
        M.on_scroll_end()
    end)

    return pages, pager.page_tiles
end

function M.get_page(i)
    return pager.page_tiles[i]
end

function M.current()
    return pager.current_page
end

function M.count()
    return pager.page_count
end

return M
