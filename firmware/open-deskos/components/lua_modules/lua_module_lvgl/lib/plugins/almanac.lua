--
-- plugins/almanac.lua -- Chinese Almanac & Date Plugin (Multi-size + App)
--
local aiodi = require("aiodi")
local lvgl = require("lvgl")

local Plugin = {}

Plugin.manifest = {
    id = "almanac",
    name = "黄曆",
    icon = "calendar",
    accent = aiodi.colors.primary,
    category = "culture",
}

Plugin.state_defaults = {}

Plugin.widgets = {
    -- 1x1 Widget: Faithful AIODI Date Tile (White bg, Red month SPE, Black day number)
    ["1x1"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 1, row_span = spec.row_span or 1,
            bg_color = aiodi.colors.primary,
            pad = 0,
        })

        local now = os.time()
        local month_str = aiodi.spaced(os.date("%b", now):upper())
        local day_str = tostring(tonumber(os.date("%d", now)) or 1)

        local digits = { cache_size = 16 }
        local font_spe = aiodi.font_bold(aiodi.px(aiodi.ref.text.spe), digits)
        local font_day = aiodi.font_bold(aiodi.px(aiodi.ref.text.day), digits)

        local month_h = font_spe and font_spe:line_height() or aiodi.px(aiodi.ref.text.spe)
        local day_h = font_day and font_day:line_height() or aiodi.px(aiodi.ref.text.day)
        local top = math.max(0, (spec.h - month_h - day_h) // 2)
        local last_tick_sec = 0

        local month_lbl = aiodi.title(tile, {
            x = 0, y = top,
            w = spec.w, h = month_h,
            text = month_str,
            text_color = aiodi.colors.red,
            font = font_spe,
            text_align = "center",
        })

        local day_lbl = aiodi.title(tile, {
            x = 0, y = top + month_h,
            w = spec.w, h = day_h,
            text = day_str,
            text_color = aiodi.colors.bg,
            font = font_day,
            text_align = "center",
        })

        return {
            root = tile,
            on_tick = function()
                -- Date only changes at midnight; don't re-format it 60 x/s.
                local cur_now = os.time()
                if cur_now == last_tick_sec then return end
                last_tick_sec = cur_now
                month_lbl:set_text(aiodi.spaced(os.date("%b", cur_now):upper()))
                day_lbl:set_text(tostring(tonumber(os.date("%d", cur_now)) or 1))
            end,
        }
    end,

    -- 3x2 Widget: Tong Sheng Rich Card
    ["3x2"] = function(parent, spec, ctx)
        local tile = aiodi.tile(parent, {
            col = spec.col, row = spec.row, col_span = spec.col_span or 3, row_span = spec.row_span or 2,
            bg_color = aiodi.colors.surface,
            pad = aiodi.space.md,
            flex = { flow = "row", main = "space_between", cross = "center" },
        })

        local left = lvgl.container(tile, {
            w = aiodi.px(120), h = spec.h - 2 * aiodi.space.md,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        left:set_clickable(false)
        left:set_flex({ flow = "column", main = "center", cross = "center" })
        aiodi.label(left, {
            text = "老黃曆",
            font = aiodi.font(aiodi.px(22)),
            color = aiodi.colors.red,
        })
        aiodi.label(left, {
            text = "吉日良辰",
            font = aiodi.font(aiodi.px(16)),
            color = aiodi.colors.primary,
        })

        local right = lvgl.container(tile, {
            w = spec.w - aiodi.px(140), h = spec.h - 2 * aiodi.space.md,
            bg_opa = 0, border_width = 0, pad = 0,
        })
        right:set_clickable(false)
        right:set_flex({ flow = "column", main = "center", cross = "start" })
        aiodi.label(right, {
            text = "宜：祈福 嫁娶 納采 出行",
            font = aiodi.font(aiodi.px(18)),
            color = aiodi.colors.green,
        })
        aiodi.label(right, {
            text = "忌：開市 安葬 動土 伐木",
            font = aiodi.font(aiodi.px(18)),
            color = aiodi.colors.red,
        })
        aiodi.label(right, {
            text = "值神：司命黃道 吉星高照",
            font = aiodi.font(aiodi.px(14)),
            color = aiodi.colors.secondary,
        })

        return {
            root = tile,
        }
    end,
}

return Plugin
