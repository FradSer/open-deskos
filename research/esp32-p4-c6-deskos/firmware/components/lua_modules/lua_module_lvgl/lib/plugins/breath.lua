--
-- plugins/breath.lua -- Mindful Breathing Plugin
--
local aiodi = require("aiodi")

local Plugin = {}

Plugin.manifest = {
    id = "breath",
    name = "Breath",
    icon = "droplet",
    accent = aiodi.colors.green,
    category = "health",
}

Plugin.state_defaults = {
    phase = 0,
}

Plugin.widgets = {
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.green,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, {
            name = "droplet",
            size = math.floor(spec.w * 0.45),
            color = aiodi.colors.primary,
            align = "center",
        })

        return {
            root = tile,
        }
    end,
}

return Plugin
