set(LAUNCHER_SOURCE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/plugins/quota.lua")
set(AIODI_SOURCE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/aiodi.lua")
set(STYLE_SOURCE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/src/lua_lvgl_style.c")
set(FEATURE_SOURCE "${ODK_ROOT}/tests/features/home-ui-polish.feature")

foreach(path IN ITEMS "${LAUNCHER_SOURCE}" "${AIODI_SOURCE}" "${STYLE_SOURCE}" "${FEATURE_SOURCE}")
    if(NOT EXISTS "${path}")
        message(FATAL_ERROR "ui polish contract input is missing: ${path}")
    endif()
endforeach()

file(READ "${LAUNCHER_SOURCE}" quota)
file(READ "${AIODI_SOURCE}" aiodi)
file(READ "${STYLE_SOURCE}" style)
file(READ "${FEATURE_SOURCE}" feature)

function(require_pattern source label pattern)
    string(FIND "${source}" "${pattern}" found)
    if(found EQUAL -1)
        message(FATAL_ERROR "${label}: missing '${pattern}'")
    endif()
endfunction()

function(forbid_pattern source label pattern)
    string(FIND "${source}" "${pattern}" found)
    if(NOT found EQUAL -1)
        message(FATAL_ERROR "${label}: unexpected '${pattern}'")
    endif()
endfunction()

foreach(pattern IN ITEMS
        "both values share the card content's left edge"
        "the countdown displays the complete \"25:00\" value inside its ring"
        "the red progress ring has more visual area than the countdown text"
        "the target font is measured against the full \"88:88\" probe inside its fixed text box"
        "a Tabler filled left arrow is visible at the leading edge"
        "the \"Back\" label is centered within the control"
        "the pressed state changes only the fill, without changing its geometry")
    require_pattern("${feature}" "acceptance scenario" "${pattern}")
endforeach()

# The quota card uses fixed full-width label boxes; a flex default must not
# re-center either the remaining percentage or reset/five-hour copy on
# different font backends.
require_pattern("${quota}" "quota percentage left anchor" [=[text = has and (prim .. "%") or "--",
            font = font_pct,
            text_color = aiodi.colors.primary,
            text_align = "left",]=])
require_pattern("${quota}" "quota reset left anchor" "local hero_gap = math.max(2, aiodi.space.xs)")
require_pattern("${quota}" "quota reset fixed bounds" "x = 0, y = lh_pct + hero_gap,")
require_pattern("${quota}" "quota reset left alignment" "text_align = \"left\",")

require_pattern("${aiodi}" "text layout harness" "function M.fit_bold_text(opts)")
require_pattern("${aiodi}" "text layout available width" "local available = math.max(1, width - 2 * padding)")

# The shared frame owns one deterministic icon+label geometry. Press feedback
# is native LVGL state styling, not an asynchronous Lua callback.
require_pattern("${aiodi}" "Back arrow" "name = \"arrow-big-left\"")
require_pattern("${aiodi}" "Back label fixed bounds" "text = \"Back\", font = back_font, text_align = \"center\"")
require_pattern("${aiodi}" "Back press token" "pressed_bg_opa = 176")
require_pattern("${style}" "pressed opacity parsed" "lua_lvgl_apply_style_int_field(L, index, obj, \"pressed_bg_opa\")")
require_pattern("${style}" "pressed opacity applied" "lv_obj_set_style_bg_opa(obj, (lv_opa_t)value, LV_STATE_PRESSED)")
