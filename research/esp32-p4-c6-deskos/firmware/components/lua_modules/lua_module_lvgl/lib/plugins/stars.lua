--
-- plugins/stars.lua -- Star Tracker Plugin
--
local aiodi = require("aiodi")

local Plugin = {}

Plugin.manifest = {
    id = "stars",
    name = "Stars",
    icon = "star",
    accent = aiodi.colors.primary,
    category = "utilities",
}

Plugin.state_defaults = {
    stars = 0,
}

Plugin.widgets = {
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, {
            name = "star",
            size = math.floor(spec.w * 0.45),
            color = aiodi.colors.primary,
        })

        local count_lbl = aiodi.label(tile, {
            text = tostring(ctx.state.stars or 0),
            font = aiodi.font_bold(aiodi.px(16)),
            color = aiodi.colors.secondary,
        })

        return {
            root = tile,
            on_click = function()
                ctx.state.stars = (ctx.state.stars or 0) + 1
                count_lbl:set_text(tostring(ctx.state.stars))
            end,
        }
    end,
}

return Plugin
