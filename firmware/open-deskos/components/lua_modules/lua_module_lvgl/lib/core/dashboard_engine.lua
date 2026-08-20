--
-- core/dashboard_engine.lua -- Pluggable Dashboard Narrative Flow Composer
--
-- Collects metrics from registered plugins and renders natural-language
-- left-aligned narrative streams matching the exact AIODI Dashboard layout.
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")
local state_store = require("state_store")
local dashboard_layout = require("dashboard_layout")
local plugin_registry = require("core.plugin_registry")

local M = {}

local NO_SCROLL = { dir = "none", scrollbar = "off" }

local DASH_BG = aiodi.colors.bg
local DASH_TEXT_MAIN = aiodi.colors.primary
local DASH_TEXT_SUB = aiodi.colors.secondary
local DASH_TEXT_NARRATIVE = aiodi.colors.secondary

local function dashboard_values(now)
    now = now or os.time()
    local values = {
        events = "3 events,",
        tasks = "2 tasks",
        habit = "1 habit",
        availability = "You're mostly free",
        after = "after 4 pm.",
        focus = "99 focus",
    }

    -- Query registered dashboard providers
    local providers = plugin_registry.get_dashboard_providers()
    for plugin_id, provider in pairs(providers) do
        local st = state_store.namespace(plugin_id)
        if type(provider.get_value) == "function" then
            local ok, val = pcall(provider.get_value, st, now)
            if ok and val and provider.metric_key then
                values[provider.metric_key] = tostring(val)
            end
        end
    end

    return values
end

--- Render a composite Dashboard narrative page.
-- @param parent lvgl_obj: Page container (slot inside input_overlay)
-- @param g table: Grid metrics
-- @param host_ctx table: Host context
-- @return table: { root, on_tick, destroy }
function M.render_page(parent, g, host_ctx)
    local W = g.w
    local H = g.h
    local now = os.time()

    local bg = lvgl.container(parent, {
        x = 0, y = 0, w = W, h = H,
        bg_color = DASH_BG, bg_opa = 255,
        border_width = 0, pad = 0,
    })
    bg:set_scroll(NO_SCROLL)
    bg:set_clickable(false)

    -- Full-width column with no side insets per design specification
    local dashboard_w = W
    local col = lvgl.container(bg, {
        x = 0, y = 0, w = dashboard_w, h = H,
        bg_opa = 0, border_width = 0, pad = 0,
        pad_row = aiodi.space.md,
    })
    col:set_scroll(NO_SCROLL)
    col:set_clickable(false)
    col:set_flex({ flow = "column", main = "start", cross = "start", track = "start" })

    -- Build and validate geometry model
    local metrics = dashboard_layout.build_metrics(aiodi, W, H)
    dashboard_layout.validate(metrics)

    -- Top Header: Day of week (left) + Full Date (right)
    local header = lvgl.container(col, {
        w = dashboard_w, h = metrics.header_h,
        bg_opa = 0, border_width = 0, pad = 0,
    })
    header:set_scroll(NO_SCROLL)
    header:set_flex({ flow = "row", main = "space_between", cross = "center" })

    local day_str = os.date("%A", now):upper()
    local date_str = os.date("%B %d", now):upper()

    local date_day = aiodi.title(header, {
        text = day_str,
        font = aiodi.font_bold(aiodi.px(32), { cache_size = 16 }),
        text_color = DASH_TEXT_MAIN,
    })
    local date_val = aiodi.caption(header, {
        text = date_str,
        font = aiodi.font(aiodi.text.body),
        text_color = DASH_TEXT_SUB,
    })

    local plan_box = lvgl.container(col, {
        w = dashboard_w, h = metrics.narrative_h,
        bg_opa = 0, border_width = 0, pad = 0,
        pad_row = metrics.row_gap,
    })
    plan_box:set_scroll(NO_SCROLL)
    plan_box:set_flex({ flow = "column", main = "start", cross = "start" })

    local function render_prose(row, part, fonts)
        local width = dashboard_layout.part_width(metrics, fonts, part)
        local item = lvgl.container(row, {
            w = width, h = fonts.row_h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        item:set_scroll(NO_SCROLL)
        aiodi.caption(item, {
            x = 0, y = fonts.prose_label_y,
            w = width, h = fonts.prose_line_height,
            text = part.text, font = fonts.prose_font, text_color = DASH_TEXT_NARRATIVE,
            floating = true,
        })
    end

    local function render_metric(row, part, fonts)
        local spec = dashboard_layout.metric_measure(metrics, fonts, part.key, part.text)
        local has_icon = part.icon ~= false
        local metric = lvgl.container(row, {
            w = dashboard_layout.part_width(metrics, fonts, part), h = fonts.row_h,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        metric:set_scroll(NO_SCROLL)
        if has_icon then
            local icon = dashboard_layout.inline_icon_frame(metrics, fonts, part.key)
            aiodi.icon_label(metric, {
                name = part.key, size = metrics.icon_size, color = DASH_TEXT_MAIN,
                x = icon.x, y = icon.y, w = icon.w, h = icon.h,
                align = "left", floating = true,
            })
        end
        aiodi.title(metric, {
            x = has_icon and dashboard_layout.icon_width(metrics, part.key) + metrics.icon_gap or 0,
            y = fonts.metric_label_y,
            w = spec.text_w, h = fonts.metric_line_height,
            text = part.text, font = fonts.metric_font, text_color = DASH_TEXT_MAIN,
            floating = true,
        })
    end

    local state = {
        last_signature = "",
    }

    local function rebuild_stream()
        local current_now = os.time()
        local vals = dashboard_values(current_now)
        local sig = string.format("%s|%s|%s|%s|%s",
            vals.events or "", vals.tasks or "", vals.habit or "", vals.focus or "", vals.availability or "")

        if sig == state.last_signature then
            return
        end
        state.last_signature = sig

        plan_box:clean()

        local plan = dashboard_layout.plan(metrics, vals)
        for _, line in ipairs(plan.rows) do
            local row = lvgl.container(plan_box, {
                w = dashboard_w, h = line.fonts.row_h,
                bg_opa = 0, border_width = 0, pad = 0,
                pad_column = line.fonts.word_gap,
            })
            row:set_scroll(NO_SCROLL)
            row:set_flex({
                flow = "row",
                main = "start",
                cross = "center",
            })
            for _, part in ipairs(line.parts) do
                if part.kind == "metric" then
                    render_metric(row, part, line.fonts)
                else
                    render_prose(row, part, line.fonts)
                end
            end
        end
    end

    rebuild_stream()

    local last_tick_sec = 0
    return {
        root = bg,
        on_tick = function()
            local cur_now = os.time()
            if cur_now == last_tick_sec then
                return
            end
            last_tick_sec = cur_now
            date_day:set_text(os.date("%A", cur_now):upper())
            date_val:set_text(os.date("%B %d", cur_now):upper())
            rebuild_stream()
        end,
    }
end

return M
