-- test_cjk.lua -- 测试CJK字体渲染
local lvgl = require("lvgl")
local scr = lvgl.create_screen()
scr:set_style({ bg_color = "#000000" })

local label = lvgl.label(scr, { text = "黄曆測試", align = "center", text_color = "#ffffff" })

local _ = lvgl.label(scr, { text = "甲乙丙丁子丑寅卯", align = "center", y = 60, text_color = "#34c759" })

local ok, f = pcall(lvgl.font_load, "fonts/NotoSansSC-Regular.ttf", { size = 28 })
if ok and f then
    local l2 = lvgl.label(scr, { text = "丙午年馬月丁酉", align = "center", y = 120, font = f, text_color = "#eb5757" })
else
    local l2 = lvgl.label(scr, { text = "font load failed: " .. tostring(f), align = "center", y = 120, text_color = "#eb5757" })
end

lvgl.run(scr)