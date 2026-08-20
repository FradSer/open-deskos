--
-- plugins/calendar.lua -- Calendar Plugin (Multi-size widgets + Dashboard provider)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "calendar",
    name = "Calendar",
    icon = "calendar",
    accent = aiodi.colors.blue,
    category = "productivity",
}

Plugin.state_defaults = {
    events_count = 3,
}

Plugin.widgets = {
    -- 1x1 Widget: Faithful AIODI Calendar Tile (Blue bg, 50% calendar icon)
    ["1x1"] = function(parent, spec, ctx)
        local g = ctx.grid_metrics or aiodi.grid_metrics()
        local icon_px = math.floor(g.cell * 0.5)

        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.blue,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, {
            name = "calendar",
            size = icon_px,
            color = aiodi.colors.primary,
        })

        return {
            root = tile,
        }
    end,

    -- 2x2 Widget: Month calendar grid
    ["2x2"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 2, row_span = spec.row_span or 2,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.md,
            flex = { flow = "column", main = "start", cross = "center" },
        })

        local now = os.time()
        local month_name = os.date("%B %Y", now):upper()

        aiodi.label(tile, {
            text = month_name,
            font = aiodi.font_bold(aiodi.px(20)),
            color = aiodi.colors.primary,
        })

        -- Weekday headers
        local wday_row = lvgl.container(tile, {
            w = spec.w - 2 * aiodi.space.md, h = aiodi.px(24),
            bg_opa = 0, border_width = 0, pad = 0,
        })
        wday_row:set_flex({ flow = "row", main = "space_between", cross = "center" })
        wday_row:set_clickable(false)
        for _, d in ipairs({ "S", "M", "T", "W", "T", "F", "S" }) do
            aiodi.label(wday_row, {
                text = d,
                font = aiodi.font(aiodi.px(14)),
                color = aiodi.colors.secondary,
            })
        end

        return {
            root = tile,
        }
    end,
}

Plugin.dashboard = {
    metric_key = "events",
    get_value = function(state, now)
        local count = state.events_count or 3
        return string.format("%d events,", count)
    end,
    icon = 0xF133,
}

return Plugin
