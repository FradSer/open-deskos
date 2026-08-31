set(LAUNCHER_SOURCE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/launcher.lua")
set(FEATURE_SOURCE "${ODK_ROOT}/tests/features/dashboard-narrative.feature")
set(HARNESS_SOURCE "${ODK_ROOT}/tests/host/dashboard_layout_harness.lua")
set(SPEC_SOURCE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/dashboard_layout.lua")
set(HOST_CMAKE_SOURCE "${ODK_ROOT}/tests/host/CMakeLists.txt")

foreach(path IN ITEMS "${LAUNCHER_SOURCE}" "${FEATURE_SOURCE}" "${HARNESS_SOURCE}" "${SPEC_SOURCE}" "${HOST_CMAKE_SOURCE}")
    if(NOT EXISTS "${path}")
        message(FATAL_ERROR "dashboard layout contract input is missing: ${path}")
    endif()
endforeach()

file(READ "${LAUNCHER_SOURCE}" launcher)
file(READ "${FEATURE_SOURCE}" feature)
file(READ "${HARNESS_SOURCE}" harness)
file(READ "${SPEC_SOURCE}" spec)
file(READ "${HOST_CMAKE_SOURCE}" host_cmake)

function(require_pattern source label pattern)
    string(FIND "${source}" "${pattern}" found)
    if(found EQUAL -1)
        message(FATAL_ERROR "${label}: missing '${pattern}'")
    endif()
endfunction()

function(forbid_pattern source label pattern)
    string(FIND "${source}" "${pattern}" found)
    if(NOT found EQUAL -1)
        message(FATAL_ERROR "${label}: must not contain '${pattern}'")
    endif()
endfunction()

foreach(pattern IN ITEMS
        "home page 1 is selected"
        "Dashboard is visible without a swipe"
        "every narrative row fits within the available page width"
        "every narrative row begins at the Dashboard's left edge"
        "no narrative row distributes residual width between sentence fragments"
        "the first row keeps \"You have 99 events,\" together"
        "\"99 tasks\" is followed by one measured word space before \"and\""
        "the conjunction remains with the preceding \"99 tasks\" phrase"
        "\"99 habits\" shares its row with \"today. You're\" when their measured widths fit"
        "every remaining phrase follows the preceding phrase until the next declared semantic boundary overflows"
        "\"after 4 pm.\" and \"99 focus\" remain in reading order"
        "no row template forces a break while the next semantic fragment still fits"
        "events, tasks, and habit are explicit placeholders"
        "focus remains an interactive Pomodoro entry"
        "events and habits retain their measured inline icons"
        "the host layout harness verifies that baseline from actual LVGL label positions"
        "inline icons use the approved downward optical offset"
        "every narrative row uses the same preferred type scale"
        "the 99-count fixture has no content outside the Dashboard container"
        "an overflowing sentence reflows only at its declared semantic boundaries"
        "no row template forces a break while the next semantic fragment still fits"
        "the planner splits it only at its declared semantic boundaries"
        "any single unbreakable value is visibly abbreviated rather than clipped"
        "no row reduces its type scale"
        "uses the AIODI black background token"
        "does not introduce a gray page surface")
    require_pattern("${feature}" "dashboard acceptance scenario" "${pattern}")
endforeach()

require_pattern("${launcher}" "dashboard is selected by default" "local home_page = 1")
require_pattern("${launcher}" "dashboard is the production startup page" "local start = 1")
require_pattern("${launcher}" "dashboard imports the shared layout spec" "local dashboard_layout = require(\"dashboard_layout\")")
require_pattern("${launcher}" "dashboard uses the shared default 99-count fixture" "return dashboard_layout.runtime_values")
require_pattern("${launcher}" "dashboard validates geometry before drawing" "dashboard_layout.validate(metrics)")
require_pattern("${launcher}" "dashboard builds a data-driven plan" "local plan = dashboard_layout.plan(metrics, values)")
require_pattern("${launcher}" "dashboard clears stale dynamic rows" "plan_box:clean()")
require_pattern("${launcher}" "dashboard renders adaptive metrics" "dashboard_layout.metric_measure(metrics, fonts, part.key, part.text)")
require_pattern("${launcher}" "dashboard uses shared adaptive icon geometry" "dashboard_layout.inline_icon_frame(metrics, fonts, part.key)")
require_pattern("${launcher}" "dashboard keeps focus interactive" "if part.key == \"focus\" then")
require_pattern("${launcher}" "dashboard re-plans only after values change" "dashboard_layout.values_signature(values)")
require_pattern("${launcher}" "dashboard has a full-width narrative canvas" "w = dashboard_w, h = metrics.narrative_h")
require_pattern("${launcher}" "dashboard keeps natural sentence spacing" "main = \"start\",")
forbid_pattern("${launcher}" "dashboard must not distribute sentence fragments" "main = #line.parts > 1 and \"space_between\" or \"start\"")
forbid_pattern("${launcher}" "dashboard must not use an independent gray background" "local DASH_BG = \"#121214\"")

foreach(pattern IN ITEMS
        "M.preferred_text_size = 26"
        "M.icon_size = 20"
        "M.icon_gap = 2"
        "M.icon_optical_offset_y = 2"
        "M.small_values"
        "M.runtime_values"
        "M.extreme_values"
        "M.flow_groups"
        "function M.resolve_group_parts(group, values)"
        "function M.icon_width(metrics, icon_name)"
        "function M.font_metrics(metrics, size)"
        "word_gap = prose:measure(\" \")"
        "function M.icon_width(metrics, icon_name)"
        "local function fit_or_abbreviate_parts(metrics, parts)"
        "local function flush_line(plan, parts, group_ids, abbreviated)"
        "mode = abbreviated and \"abbreviate\" or \"flow\""
        "local function abbreviate_text(font, text, max_width)"
        "function M.plan(metrics, values)"
        "alignment = \"start\""
        "function M.values_signature(values)"
        "function M.inline_icon_frame(metrics, fonts, icon_name)"
        "shared_base_line = shared_base_line"
        "icon_optical_offset_y"
        "line %d overflows")
    require_pattern("${spec}" "shared layout spec" "${pattern}")
endforeach()

foreach(pattern IN ITEMS
        "local _, item_y = item:get_pos()"
        "local _, label_y = label:get_pos()"
        "metric baseline drifted"
        "prose baseline drifted"
        "rendered icon optical offset drifted"
        "verify_plan_shape(metrics, layout.small_values, \"small\", { preferred = true })"
        "verify_plan_shape(metrics, layout.runtime_values, \"runtime\", { preferred = true,"
        "default opening sentence did not remain on one line"
        "habit did not share its row with today's opening phrase"
        "events icon was removed from the default Dashboard"
        "habit icon was removed from the default Dashboard"
        "broke before semantic group"
        "changed Dashboard type scale"
        "verify_plan_shape(metrics, layout.extreme_values, \"extreme\", {"
        "did not keep one measured word space"
        "verify_rendered_plan(root, metrics, small, \"small\")"
        "verify_rendered_plan(root, metrics, runtime, \"runtime\")"
        "verify_rendered_plan(root, metrics, extreme, \"extreme\")"
        "rendered icon optical offset drifted")
    require_pattern("${harness}" "object-level layout harness" "${pattern}")
endforeach()

require_pattern("${host_cmake}" "Dashboard harness is runnable through CTest" "add_test(NAME dashboard_layout_harness")
require_pattern("${host_cmake}" "Dashboard harness runs native SDL" "sim/native_sdl/run.sh")
