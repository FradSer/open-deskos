--
-- plugins/mantra.lua -- Daily Quote & Affirmation Plugin
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "mantra",
    name = "Mantra",
    icon = "star",
    accent = aiodi.colors.primary,
    category = "lifestyle",
}

Plugin.state_defaults = {
    idx = 1,
}

local QUOTES = {
    "Focus on the work.",
    "Breathe deeply.",
    "Stay curious.",
    "One thing at a time.",
}

Plugin.widgets = {
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.sm,
            flex = { flow = "column", main = "center", cross = "center", track = "center" },
        })

        aiodi.icon_label(tile, { name = "star", size = 28, color = aiodi.colors.primary })
        aiodi.label(tile, {
            text = "MANTRA",
            font = aiodi.font_bold(aiodi.px(14)),
            color = aiodi.colors.secondary,
        })

        return {
            root = tile,
            on_click = function()
                ctx.state.idx = ((ctx.state.idx or 1) % 4) + 1
            end,
        }
    end,

    ["3x1"] = function(parent, spec, ctx)
        local st = ctx.state
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 3, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.md,
            flex = { flow = "row", main = "space_between", cross = "center" },
        })

        aiodi.icon_label(tile, { name = "star", size = 32, color = aiodi.colors.primary })

        local text_box = lvgl.container(tile, {
            w = spec.w - aiodi.px(80), h = spec.h - 2 * aiodi.space.md,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        text_box:set_clickable(false)
        text_box:set_flex({ flow = "column", main = "center", cross = "start" })

        local quote_lbl = aiodi.label(text_box, {
            text = QUOTES[st.idx or 1] or QUOTES[1],
            font = aiodi.font(aiodi.px(20)),
            color = aiodi.colors.primary,
        })

        return {
            root = tile,
            on_click = function()
                ctx.state.idx = ((ctx.state.idx or 1) % 4) + 1
                quote_lbl:set_text(QUOTES[ctx.state.idx] or QUOTES[1])
            end,
        }
    end,
}

return Plugin
