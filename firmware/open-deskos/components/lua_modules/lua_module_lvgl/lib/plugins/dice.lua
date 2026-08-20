--
-- plugins/dice.lua -- Roll a Die Plugin
--
local aiodi = require("aiodi")

local Plugin = {}

Plugin.manifest = {
    id = "dice",
    name = "Dice",
    icon = "dice",
    accent = aiodi.colors.button,
    category = "games",
}

Plugin.state_defaults = {
    face = 1,
}

Plugin.widgets = {
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.button,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, {
            name = "dice",
            size = math.floor(spec.w * 0.45),
            color = aiodi.colors.primary,
            align = "center",
        })

        return {
            root = tile,
            on_click = function()
                ctx.state.face = math.random(1, 6)
            end,
        }
    end,
}

return Plugin
