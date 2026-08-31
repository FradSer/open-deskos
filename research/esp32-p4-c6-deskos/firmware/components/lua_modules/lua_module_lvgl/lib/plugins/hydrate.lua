--
-- plugins/hydrate.lua -- Water Intake Tracking Plugin
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "hydrate",
    name = "Hydrate",
    icon = "droplet",
    accent = aiodi.colors.blue,
    category = "health",
}

Plugin.state_defaults = {
    count = 0,
    goal = 8,
}

Plugin.widgets = {
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.blue,
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
            on_click = function()
                ctx.state.count = (ctx.state.count or 0) + 1
            end,
        }
    end,

    ["1x2"] = function(parent, spec, ctx)
        local st = ctx.state
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 2,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.md,
            flex = { flow = "column", main = "space_between", cross = "center" },
        })

        local top = lvgl.container(tile, { bg_opa = 0, border_width = 0, pad = 0 })
        top:set_clickable(false)
        top:set_flex({ flow = "column", main = "center", cross = "center" })
        aiodi.icon_label(top, { name = "droplet", size = 28, color = aiodi.colors.blue })
        local count_lbl = aiodi.label(top, {
            text = tostring(st.count or 0) .. "/" .. tostring(st.goal or 8),
            font = aiodi.font_bold(aiodi.px(24)),
            color = aiodi.colors.primary,
        })

        local btn = aiodi.pill_button(tile, {
            text = "+1",
            w = aiodi.px(72), h = aiodi.px(44),
            bg_color = aiodi.colors.blue,
        })
        btn:on("clicked", function()
            st.count = (st.count or 0) + 1
            count_lbl:set_text(tostring(st.count) .. "/" .. tostring(st.goal or 8))
        end)

        return {
            root = tile,
        }
    end,
}

return Plugin
