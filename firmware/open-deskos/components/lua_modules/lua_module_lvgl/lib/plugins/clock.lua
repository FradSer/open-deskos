--
-- plugins/clock.lua -- Clock & Time Plugin (Multi-size widgets + Fullscreen App)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "clock",
    name = "Clock",
    icon = "bolt",
    accent = aiodi.colors.bg,
    category = "utilities",
}

Plugin.state_defaults = {}

Plugin.widgets = {
    -- 1x1 Widget: Minimal Clock
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.bg,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        local font = aiodi.font_bold(aiodi.px(36), { cache_size = 16 })
        local time_lbl = aiodi.clock(tile, {
            text = os.date("%H:%M"),
            font = font,
            color = aiodi.colors.primary,
        })

        local last_tick_sec = 0

        return {
            root = tile,
            on_tick = function()
                local now = os.time()
                if now == last_tick_sec then return end
                last_tick_sec = now
                time_lbl:set_text(os.date("%H:%M", now))
            end,
        }
    end,

    -- 2x1 Widget: Faithful AIODI Homepage / #1 Clock (Pure black, 52px Montserrat Bold digits)
    ["2x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 2, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.bg,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        local clock_font = aiodi.font_bold(aiodi.px(aiodi.ref.text.clock), { cache_size = 16 })
        local clock_lbl = aiodi.clock(tile, {
            text = os.date("%H:%M"),
            font = clock_font,
            text_color = aiodi.colors.primary,
        })

        local last_tick_sec = 0

        return {
            root = tile,
            on_tick = function()
                local now = os.time()
                if now == last_tick_sec then return end
                last_tick_sec = now
                clock_lbl:set_text(os.date("%H:%M", now))
            end,
        }
    end,
}

return Plugin
