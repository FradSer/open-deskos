-- Validate lvgl.SYMBOL catalog (FontAwesome UTF-8 strings in Montserrat).
local lvgl = require("lvgl")

assert(type(lvgl.SYMBOL) == "table", "lvgl.SYMBOL missing")

local required = {
    "ok", "close", "home", "settings", "refresh", "wifi", "warning",
    "power", "play", "pause", "battery_full", "bluetooth", "gps",
}

for _, name in ipairs(required) do
    local value = lvgl.SYMBOL[name]
    assert(type(value) == "string" and #value > 0,
           "lvgl.SYMBOL." .. name .. " missing or empty")
end

-- Must not collide with emoji tofu path: symbols are multi-byte UTF-8.
assert(#lvgl.SYMBOL.refresh >= 3, "refresh symbol should be UTF-8")

print("lvgl.SYMBOL ok (" .. tostring(#required) .. "+ keys checked)")
return true
