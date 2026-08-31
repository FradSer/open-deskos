--
-- plugins/year.lua -- Year Progress Plugin (Multi-size widgets + Fullscreen App)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "year",
    name = "Year",
    icon = "leaf",
    accent = aiodi.colors.bg,
    category = "utilities",
}

Plugin.state_defaults = {}

local function year_progress(now)
    now = now or os.time()
    local year = tonumber(os.date("%Y", now)) or 2026
    local is_leap = (year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0))
    local total_days = is_leap and 366 or 365
    local yday = tonumber(os.date("%j", now)) or 1
    local pct = math.floor((yday / total_days) * 100 + 0.5)
    return pct, yday, total_days
end

Plugin.widgets = {
    -- 1x1 Widget: Big percent
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        local pct = year_progress(os.time())
        local pct_lbl = aiodi.label(tile, {
            text = tostring(pct) .. "%",
            font = aiodi.font_bold(aiodi.px(36)),
            color = aiodi.colors.primary,
        })
        aiodi.label(tile, {
            text = "YEAR",
            font = aiodi.font_bold(aiodi.px(14)),
            color = aiodi.colors.green,
        })

        local last_tick_sec = 0
        local last_pct = -1

        return {
            root = tile,
            on_tick = function()
                local now = os.time()
                if now == last_tick_sec then return end
                last_tick_sec = now
                local cur_pct = year_progress(now)
                if cur_pct ~= last_pct then
                    last_pct = cur_pct
                    pct_lbl:set_text(tostring(cur_pct) .. "%")
                end
            end,
        }
    end,

    -- 2x1 Widget: Faithful AIODI Year Progress Meter Bar
    ["2x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 2, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            clip_corner = 1,
            pad = 0,
        })

        local g = ctx.grid_metrics or aiodi.grid_metrics()
        local inner_w = spec.w - 2 * (g.stroke or 2)
        local inner_h = spec.h - 2 * (g.stroke or 2)
        local pct = year_progress(os.time())

        local meter = aiodi.meter(tile, {
            w = inner_w, h = inner_h,
            pct = pct,
            fill = aiodi.colors.green,
            label = "Year",
            value = pct .. "%",
            font = aiodi.font_bold(aiodi.px(aiodi.ref.text.label), { cache_size = 16 }),
            radius = 0,
            chrome = "center",
            pad_x = aiodi.px(12),
        })

        local last_tick_sec = 0
        local last_pct = -1

        return {
            root = tile,
            on_tick = function()
                local now = os.time()
                if now == last_tick_sec then return end
                last_tick_sec = now
                local cur_pct = year_progress(now)
                if cur_pct == last_pct then return end
                last_pct = cur_pct
                if meter and meter.value then
                    meter.value:set_text(cur_pct .. "%")
                end
                if meter and meter.fill then
                    meter.fill:set_size(math.max(1, (meter.track_w * cur_pct) // 100), meter.bar_h)
                end
            end,
        }
    end,
}

return Plugin
