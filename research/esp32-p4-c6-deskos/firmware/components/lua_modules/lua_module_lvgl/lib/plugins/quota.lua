--
-- plugins/quota.lua -- OpenCode Go Quota & Usage Plugin (Multi-size + Full Card + Peek)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "quota",
    name = "Quota",
    icon = "link",
    accent = aiodi.colors.primary,
    category = "developer",
}

Plugin.state_defaults = {
    primary_pct = 76,
    primary_reset_min = 222,
    week_pct = 45,
    month_pct = 68,
    zen = "1,250",
}

local function get_sub(key, default)
    if type(_G.sub_get) == "function" then
        local v = _G.sub_get(key)
        if v ~= nil and v ~= "" then return v end
    end
    return default
end

local function sub_has_data()
    return get_sub("primaryPct", nil) ~= nil
end

Plugin.widgets = {
    -- Compact S3 page: keep all quota data inside one 2x2 tile.
    ["2x2"] = function(parent, spec, ctx)
        local g = ctx.grid_metrics or aiodi.grid_metrics()
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = 2, row_span = 2,
            bg_color = aiodi.colors.surface, pad = g.gutter,
            flex = { flow = "column", main = "space_between", cross = "start" },
        })
        local pct = tonumber(get_sub("primaryPct", nil))
        aiodi.caption(tile, { text = "OPENCODE GO", font = aiodi.font(aiodi.px(12)) })
        aiodi.clock(tile, {
            text = pct and (pct .. "%") or "--",
            font = aiodi.font_bold(aiodi.px(42)),
            text_color = aiodi.colors.primary,
        })
        aiodi.caption(tile, {
            text = pct and "Rolling usage" or "Connect Mac",
            font = aiodi.font(aiodi.px(12)),
            text_color = aiodi.colors.secondary,
        })
        return { root = tile }
    end,

    -- 2x1 Widget: Large percent number + reset time
    ["2x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 2, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.md,
            flex = { flow = "row", main = "space_between", cross = "center" },
        })

        local left = lvgl.container(tile, { bg_opa = 0, border_width = 0, pad = 0 })
        left:set_clickable(false)
        left:set_flex({ flow = "column", main = "center", cross = "start" })
        aiodi.label(left, {
            text = "AGENT USAGE",
            font = aiodi.font(aiodi.px(16)),
            color = aiodi.colors.secondary,
        })
        local pct_lbl = aiodi.label(left, {
            text = "76%",
            font = aiodi.font_bold(aiodi.px(48)),
            color = aiodi.colors.primary,
        })

        local right = lvgl.container(tile, { bg_opa = 0, border_width = 0, pad = 0 })
        right:set_clickable(false)
        right:set_flex({ flow = "column", main = "center", cross = "end" })
        aiodi.label(right, {
            text = "RESETS IN",
            font = aiodi.font(aiodi.px(14)),
            color = aiodi.colors.secondary,
        })
        local reset_lbl = aiodi.label(right, {
            text = "3h 42m",
            font = aiodi.font_bold(aiodi.px(18)),
            color = aiodi.colors.blue,
        })

        return {
            root = tile,
        }
    end,

    -- 3x4 Full Page Card: Faithful AIODI OpenCode Go Monitor Page
    ["3x4"] = function(parent, spec, ctx)
        local g = ctx.grid_metrics or aiodi.grid_metrics()
        local card_pad = math.max(aiodi.space.sm, g.gutter // 2)
        local card_w = spec.w - 2 * (g.stroke or 2)
        local card_h = spec.h - 2 * (g.stroke or 2)

        if type(_G.sub_request_fresh) == "function" then
            _G.sub_request_fresh()
        end

        local has = sub_has_data()
        local prim = tonumber(get_sub("primaryPct", nil)) or 0
        local reset_min = tonumber(get_sub("primaryResetMin", nil))
        local week = tonumber(get_sub("weekPct", nil)) or 0
        local month = tonumber(get_sub("monthPct", nil)) or 0
        local zen = get_sub("zen", "")

        local digits = { cache_size = 16 }
        local font_bar = aiodi.font_bold(aiodi.px(aiodi.ref.text.bar_time), digits)
        local font_pct = aiodi.font_bold(aiodi.px(72), digits)

        local lh_small = font_bar and font_bar:line_height() or aiodi.px(aiodi.ref.text.bar_time)
        local lh_pct = font_pct and font_pct:line_height() or aiodi.px(72)

        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 3, row_span = spec.row_span or 4,
            bg_color = aiodi.colors.surface,
            pad = card_pad,
            clip_corner = 1,
            flex = { flow = "column", main = "space_between", cross = "start", track = "center" },
        })

        -- Brand Watermark Icon (Top-right, floating, opacity 100)
        local logo_h = aiodi.px(96)
        local logo_w = math.floor(logo_h * 240 / 300 + 0.5)
        local logo = aiodi.brand_icon(tile, { size = logo_h })
        if logo then
            logo:set_style({ floating = true, opa = 100 })
            logo:set_pos(card_w - logo_w - 8, 80)
        end

        -- Header row: OPENCODE GO
        aiodi.caption(tile, {
            text = aiodi.spaced("OPENCODE GO"),
            font = font_bar,
        })

        -- Hero 5-Hour Rolling Window
        local hero_gap = math.max(2, aiodi.space.xs)
        local hero_box = lvgl.container(tile, {
            w = card_w - 2 * card_pad, h = lh_pct + lh_small + hero_gap,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        hero_box:set_scroll({ dir = "none", scrollbar = "off" })
        hero_box:set_clickable(false)

        local prim_lbl = aiodi.clock(hero_box, {
            x = 0, y = 0, w = card_w - 2 * card_pad, h = lh_pct,
            text = has and (prim .. "%") or "--",
            font = font_pct,
            text_color = aiodi.colors.primary,
            text_align = "left",
        })

        local reset_str = "Connect Mac"
        if has then
            if reset_min and reset_min > 0 then
                local total_min = math.floor(reset_min)
                local hrs = total_min // 60
                local mins = total_min % 60
                reset_str = (hrs > 0) and string.format("Reset in %dh %dm", math.floor(hrs), math.floor(mins))
                    or string.format("Reset in %dm", math.floor(mins))
            else
                reset_str = "5-hr Window"
            end
        end

        local reset_lbl = aiodi.caption(hero_box, {
            x = 0, y = lh_pct + hero_gap,
            w = card_w - 2 * card_pad, h = lh_small,
            text = reset_str,
            font = font_bar,
            text_color = aiodi.colors.secondary,
            text_align = "left",
        })

        -- Weekly meter
        local week_meter = aiodi.meter(tile, {
            w = card_w - 2 * card_pad, h = aiodi.px(48),
            pct = week,
            fill = aiodi.colors.blue,
            label = "Weekly Limit",
            value = has and (week .. "%") or "--",
            font = font_bar,
            chrome = "space_between",
            pad_x = aiodi.px(12),
        })

        -- Monthly meter
        local month_meter = aiodi.meter(tile, {
            w = card_w - 2 * card_pad, h = aiodi.px(48),
            pct = month,
            fill = aiodi.colors.green,
            label = "Monthly Limit",
            value = has and (month .. "%") or "--",
            font = font_bar,
            chrome = "space_between",
            pad_x = aiodi.px(12),
        })

        -- Zen balance row
        local zen_row = lvgl.container(tile, {
            w = card_w - 2 * card_pad, h = lh_small,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        zen_row:set_scroll({ dir = "none", scrollbar = "off" })
        zen_row:set_clickable(false)
        zen_row:set_flex({ flow = "row", main = "space_between", cross = "center" })

        aiodi.caption(zen_row, {
            text = "Zen Credits",
            font = font_bar,
            text_color = aiodi.colors.secondary,
        })
        local zen_lbl = aiodi.caption(zen_row, {
            text = has and (zen ~= "" and ("$" .. zen) or "$0.00") or "--",
            font = font_bar,
            text_color = aiodi.colors.primary,
        })

        local last_has, last_prim, last_reset_min, last_week, last_month, last_zen
        local last_tick_sec = 0

        return {
            root = tile,
            on_tick = function()
                -- Quota is a 1 Hz data source; skip the six sub queries on
                -- every 16 ms frame.
                local now = os.time()
                if now == last_tick_sec then return end
                last_tick_sec = now

                local cur_has = sub_has_data()
                local cur_prim = tonumber(get_sub("primaryPct", nil)) or 0
                local cur_reset_min = tonumber(get_sub("primaryResetMin", nil))
                local cur_week = tonumber(get_sub("weekPct", nil)) or 0
                local cur_month = tonumber(get_sub("monthPct", nil)) or 0
                local cur_zen = get_sub("zen", "")
                local has_changed = cur_has ~= last_has

                if has_changed or cur_prim ~= last_prim then
                    last_prim = cur_prim
                    prim_lbl:set_text(cur_has and (cur_prim .. "%") or "--")
                end
                if has_changed or cur_reset_min ~= last_reset_min then
                    last_reset_min = cur_reset_min
                    local str = "Connect Mac"
                    if cur_has then
                        if cur_reset_min then
                            local h = cur_reset_min // 60
                            local m = cur_reset_min % 60
                            str = (h > 0) and string.format("Reset in %dh %dm", h, m) or string.format("Reset in %dm", m)
                        else
                            str = "5-hr Window"
                        end
                    end
                    reset_lbl:set_text(str)
                end

                if has_changed or cur_week ~= last_week then
                    last_week = cur_week
                    if week_meter and week_meter.value then
                        week_meter.value:set_text(cur_has and (cur_week .. "%") or "--")
                        week_meter.fill:set_size(math.max(1, (week_meter.track_w * (cur_has and cur_week or 0)) // 100), week_meter.bar_h)
                    end
                end
                if has_changed or cur_month ~= last_month then
                    last_month = cur_month
                    if month_meter and month_meter.value then
                        month_meter.value:set_text(cur_has and (cur_month .. "%") or "--")
                        month_meter.fill:set_size(math.max(1, (month_meter.track_w * (cur_has and cur_month or 0)) // 100), month_meter.bar_h)
                    end
                end
                if has_changed or cur_zen ~= last_zen then
                    last_zen = cur_zen
                    zen_lbl:set_text(cur_has and (cur_zen ~= "" and ("$" .. cur_zen) or "$0.00") or "--")
                end
                last_has = cur_has
            end,
        }
    end,
}

return Plugin
