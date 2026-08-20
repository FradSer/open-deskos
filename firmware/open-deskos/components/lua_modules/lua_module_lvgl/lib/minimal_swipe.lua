-- minimal_swipe.lua — isolated horizontal-pager swipe cost demo.
--
-- Purpose: measure the RAW cost of scrolling the launcher's pager geometry on
-- this exact LVGL build + panel, WITHOUT the launcher's page content (SVG
-- icons, big fonts, ~100 widgets, rounded corners). If this demo scrolls at
-- full speed, the launcher's jank is in its page content; if this also janks,
-- the bottleneck is in the scroll container / render path itself.
--
-- Builds 3 full-screen pages, each a single flat colored container with one
-- small label (no SVG, no radius, no big fonts). Same scroll config as launcher:
--   pages container: w×h, flex row, scroll dir=hor snap_x=start elastic
--                   momentum, scrollbar off.
-- Reports real [swipe] wall-clock telemetry (same format as launcher).
--
-- Mode-agnostic:
--   * shell mode (device, `cerb ui "swipe"`): ctx.root is nil — build a
--     full-canvas screen and load it (launcher-style).
--   * app mode (sim `@file`): ctx.root is the app content column — build the
--     pager into it (the header reduces the canvas, fine for a cost probe).

local lvgl = require("lvgl")
local aiodi = require("aiodi")

local M = {}

-- Palette for the 3 pages (flat fills, no gradients / radius).
local PAGE_COLORS = { "#16223b", "#1d2c4a", "#241e33" }

local swipe_in_progress = false
local swipe_start_ms = 0
local swipe_frame_count = 0

local function now_ms()
    return lvgl.tick_ms()
end

function M.on_start(ctx)
    local w = ctx.width or 480
    local h = ctx.height or 800

    -- Parent: in shell mode build a full-canvas screen; in app mode use root.
    local scr
    local parent
    if ctx.root then
        parent = ctx.root
    else
        scr = aiodi.screen()
        parent = scr
    end

    -- Inter-page gutter identical to launcher's grid gutter (~24 device px).
    local page_gap = math.floor(w * 0.05)
    local slot_w = w + page_gap

    -- Horizontal pager: page | gap | page. Same scroll config as launcher.
    local pages = lvgl.container(parent, {
        x = 0, y = 0, w = w, h = h,
        bg_opa = 0, border_width = 0, pad = 0,
        pad_column = page_gap })
    pages:set_scroll({
        dir = "hor", scrollbar = "off", snap_x = "start",
        elastic = true, momentum = true })
    pages:set_flex({
        flow = "row", main = "start", cross = "start", track = "center" })

    -- Small body font (cached by aiodi). The ONLY non-flat content —
    -- deliberately far cheaper than the launcher's clock/SVG/big-type pages.
    local small = aiodi.font(aiodi.px(20))

    for i = 1, 3 do
        local page = lvgl.container(pages, {
            w = w, h = h,
            bg_opa = 255,
            radius = 0, border_width = 0, pad = 0 })
        page:set_scroll({ dir = "none", scrollbar = "off" })
        -- create-opts bg_color is ignored — must set via set_style.
        page:set_style({ bg_color = PAGE_COLORS[i], bg_opa = 255 })
        local label = lvgl.label(page, {
            text = "Page " .. i,
            text_color = "#ffffff",
            font = small,
        })
        label:align("center")
    end

    pages:on("scroll", function()
        if not swipe_in_progress then
            swipe_in_progress = true
            swipe_start_ms = now_ms()
            swipe_frame_count = 0
        end
        swipe_frame_count = swipe_frame_count + 1
    end)

    pages:on("scroll_end", function()
        if swipe_start_ms > 0 then
            local dur = now_ms() - swipe_start_ms
            if dur < 0 then
                dur = dur + 4294967296 -- 2^32 wrap
            end
            print(string.format("[minimal-swipe] duration=%dms frames=%d avg=%.1fms/frame",
                                dur, swipe_frame_count,
                                swipe_frame_count > 0 and (dur / swipe_frame_count) or 0))
            swipe_start_ms = 0
            swipe_in_progress = false
            swipe_frame_count = 0
        end
    end)

    -- Shell mode: the module owns screen loading (launcher-style).
    if scr then
        scr:load()
    end

    M._pages = pages
    M._slot_w = slot_w
    print("[minimal-swipe] on_start done; pages=" .. tostring(pages) .. " slot=" .. slot_w)
    return pages
end

-- Auto-swipe driver: after the demo is up (~2s), run a few page changes so
-- [minimal-swipe] telemetry streams without needing a finger. Gated the same
-- way as the launcher: sim env, or device `odk_swipe_test=1` sub key.
local auto_swipe_delay = 0
local auto_swipe_idx = 0
local auto_swipe_seq = { 2, 3, 1, 2, 3 }
local auto_swipe_done = false

function M.on_tick(ctx)
    if not M._pages then
        return
    end
    if not auto_swipe_done then
        auto_swipe_delay = auto_swipe_delay + 1
        local enabled = os.getenv and os.getenv("ODK_SIM_SWIPE_TO")
        if not enabled then
            enabled = (_G.sub_get and _G.sub_get("odk_swipe_test")) == "1"
        end
        if enabled and auto_swipe_delay >= 120 then
            print("[minimal-swipe] auto-swipe armed, idx=" .. auto_swipe_idx)
            auto_swipe_idx = auto_swipe_idx + 1
            if auto_swipe_idx <= #auto_swipe_seq then
                local slot = M._slot_w or (ctx.width or 480)
                M._pages:scroll_to((auto_swipe_seq[auto_swipe_idx] - 1) * slot, 0, true)
            else
                auto_swipe_done = true
                print("[minimal-swipe] stress test done")
            end
            auto_swipe_delay = 0
        end
    end
end

function M.on_stop(ctx)
end

return M
