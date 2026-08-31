--
-- plugins/chat.lua -- AI Assistant Chat Plugin (Multi-size + App)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "chat",
    name = "Chat",
    icon = "mail",
    accent = aiodi.colors.surface,
    category = "ai",
}

Plugin.state_defaults = {
    history_count = 0,
}

Plugin.widgets = {
    -- 1x1 Widget: Faithful AIODI Chat Tile (Surface bg, 50% mail icon)
    ["1x1"] = function(parent, spec, ctx)
        local g = ctx.grid_metrics or aiodi.grid_metrics()
        local icon_px = math.floor(g.cell * 0.5)

        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = 0,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, {
            name = "mail",
            size = icon_px,
            color = aiodi.colors.primary,
        })

        return {
            root = tile,
        }
    end,

    -- 2x1 Widget: Chat preview
    ["2x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 2, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.md,
            flex = { flow = "row", main = "start", cross = "center" },
        })

        aiodi.icon_label(tile, {
            name = "mail",
            size = aiodi.px(32),
            color = aiodi.colors.primary,
        })

        local right = lvgl.container(tile, { bg_opa = 0, border_width = 0, pad = 0 })
        right:set_clickable(false)
        right:set_flex({ flow = "column", main = "center", cross = "start" })
        aiodi.label(right, {
            text = " AI Assistant",
            font = aiodi.font_bold(aiodi.px(18)),
            color = aiodi.colors.primary,
        })
        aiodi.label(right, {
            text = " Tap to chat...",
            font = aiodi.font(aiodi.px(14)),
            color = aiodi.colors.secondary,
        })

        return {
            root = tile,
        }
    end,
}

return Plugin
