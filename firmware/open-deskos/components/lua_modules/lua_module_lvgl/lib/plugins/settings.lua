--
-- plugins/settings.lua -- System Settings Plugin (Multi-size + App)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "settings",
    name = "Settings",
    icon = "settings",
    accent = aiodi.colors.bg,
    category = "system",
}

Plugin.state_defaults = {}

Plugin.widgets = {
    -- 1x1 Widget: Faithful AIODI Settings Tile (Surface bg, stroke_focus border #b5b5b5, gear icon)
    ["1x1"] = function(parent, spec, ctx)
        local g = ctx.grid_metrics or aiodi.grid_metrics()
        local icon_px = math.floor(g.cell * 0.5)

        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            border_color = aiodi.colors.stroke_focus,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, {
            name = "settings",
            size = icon_px,
            color = aiodi.colors.primary,
        })

        return {
            root = tile,
        }
    end,
}

return Plugin
