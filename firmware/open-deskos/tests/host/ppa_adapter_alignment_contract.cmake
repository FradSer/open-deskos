set(EDGE_AGENT_ROOT "${ODK_ROOT}/application/edge_agent")
set(PATCH_SOURCE "${EDGE_AGENT_ROOT}/tools/patch_esp_lvgl_adapter_ppa_alignment.py")
set(NATIVE_PATCH_SOURCE "${EDGE_AGENT_ROOT}/tools/patch_lvgl_ppa_cache_unaligned.py")
set(CMAKE_SOURCE "${EDGE_AGENT_ROOT}/CMakeLists.txt")
set(LVGL_COMPONENT_CMAKE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/CMakeLists.txt")
set(ADAPTER_SOURCE "${EDGE_AGENT_ROOT}/managed_components/espressif__esp_lvgl_adapter/src/display/bridge/v9/lvgl_ppa_accel_v9.c")
set(LVGL_PPA_SOURCE "${EDGE_AGENT_ROOT}/managed_components/lvgl__lvgl/src/draw/espressif/ppa/lv_draw_ppa.c")
set(LVGL_PPA_IMAGE_SOURCE "${EDGE_AGENT_ROOT}/managed_components/lvgl__lvgl/src/draw/espressif/ppa/lv_draw_ppa_img.c")

foreach(path IN ITEMS "${PATCH_SOURCE}" "${NATIVE_PATCH_SOURCE}" "${CMAKE_SOURCE}" "${LVGL_COMPONENT_CMAKE}" "${ADAPTER_SOURCE}" "${LVGL_PPA_SOURCE}" "${LVGL_PPA_IMAGE_SOURCE}")
    if(NOT EXISTS "${path}")
        message(FATAL_ERROR "PPA adapter alignment contract input is missing: ${path}")
    endif()
endforeach()

file(READ "${PATCH_SOURCE}" patch)
file(READ "${NATIVE_PATCH_SOURCE}" native_patch)
file(READ "${CMAKE_SOURCE}" cmake_source)
file(READ "${LVGL_COMPONENT_CMAKE}" lvgl_component_cmake)

find_program(HOST_PYTHON NAMES python3 python REQUIRED)
execute_process(
    COMMAND "${HOST_PYTHON}" "${PATCH_SOURCE}"
    WORKING_DIRECTORY "${EDGE_AGENT_ROOT}"
    RESULT_VARIABLE patch_result
)
if(NOT patch_result EQUAL 0)
    message(FATAL_ERROR "PPA adapter alignment patch failed with ${patch_result}")
endif()
execute_process(
    COMMAND "${HOST_PYTHON}" "${NATIVE_PATCH_SOURCE}"
    WORKING_DIRECTORY "${EDGE_AGENT_ROOT}"
    RESULT_VARIABLE native_patch_result
)
if(NOT native_patch_result EQUAL 0)
    message(FATAL_ERROR "LVGL native PPA alignment patch failed with ${native_patch_result}")
endif()
file(READ "${ADAPTER_SOURCE}" adapter)
file(READ "${LVGL_PPA_SOURCE}" native_ppa)
file(READ "${LVGL_PPA_IMAGE_SOURCE}" native_ppa_image)

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

# On ESP32-P4 the PPA driver validates output buffers against the PSRAM DMA
# cache-line requirement. The adapter must use that exact requirement when it
# chooses its PPA path and must fall back to LVGL's software blend path if a
# transient/snapshot layer cannot meet it. PPA input validation is expected;
# turning a rejected operation into ESP_ERROR_CHECK aborts the whole UI task.
require_pattern("${cmake_source}" "adapter PPA alignment patch runs at configure" "patch_esp_lvgl_adapter_ppa_alignment.py")
require_pattern("${patch}" "PPA alignment uses the driver's PSRAM DMA requirement" "MALLOC_CAP_SPIRAM | MALLOC_CAP_DMA")
require_pattern("${patch}" "PPA alignment helper" "ppa_get_hardware_alignment")
require_pattern("${patch}" "RGB565 output uses two bytes per pixel" "* 2U")
require_pattern("${patch}" "fill rejection falls back to software" "lv_draw_ppa_v9_sw_fallback(t, dsc)")
require_pattern("${patch}" "blend rejection falls back to software" "ppa_blend(bg_buf")
require_pattern("${adapter}" "patched handler uses PPA hardware alignment" "ppa_get_hardware_alignment")
require_pattern("${adapter}" "patched RGB565 output uses two bytes per pixel" "(size_t)bg_w * bg_h * 2U")
require_pattern("${adapter}" "patched fill rejection falls back to software" "lv_draw_ppa_v9_sw_fallback(t, dsc)")
require_pattern("${adapter}" "patched blend returns an error rather than aborting" "static esp_err_t ppa_blend")
require_pattern("${adapter}" "patched fill returns an error rather than aborting" "static esp_err_t ppa_fill")
forbid_pattern("${adapter}" "custom PPA fill must not abort the UI" "ESP_ERROR_CHECK(ppa_do_fill(s_fill_handle, &cfg))")
forbid_pattern("${adapter}" "custom PPA blend must not abort the UI" "ESP_ERROR_CHECK(ppa_do_blend(s_blend_handle, &cfg))")

# LVGL's built-in ESP-PPA unit may own simple fill tasks before the adapter's
# custom blend handler sees them. It must decline an output layer whose actual
# address or allocation size cannot meet the PPA driver's cache-line contract;
# returning IDLE leaves the task available to LVGL's software draw unit.
require_pattern("${cmake_source}" "native PPA safety patch runs at configure" "patch_lvgl_ppa_cache_unaligned.py")
require_pattern("${native_patch}" "native PPA checks the P4 cache-line size" "CONFIG_CACHE_L2_CACHE_LINE_SIZE")
require_pattern("${native_patch}" "native PPA eligibility helper" "lv_draw_ppa_output_buffer_ready")
require_pattern("${native_ppa}" "native PPA output eligibility helper" "lv_draw_ppa_output_buffer_ready")
require_pattern("${native_ppa}" "native PPA leaves ineligible task for software" "if(!lv_draw_ppa_output_buffer_ready(layer->draw_buf))")
require_pattern("${native_ppa}" "native PPA dispatch returns idle for software fallback" "return LV_DRAW_UNIT_IDLE;")

# A PPA image operation can still fail after its output layer passed the
# eligibility gate (for example because an input snapshot is unsuitable for
# the hardware). The native draw unit has already claimed that task, so it
# must draw it in software instead of marking an empty image task finished.
require_pattern("${native_patch}" "native PPA image rejection fallback marker" "ODK_LVGL_PPA_IMAGE_FALLBACK")
require_pattern("${native_patch}" "native PPA image rejection calls software renderer" "lv_draw_sw_image(t, draw_dsc, img_coords);")
require_pattern("${native_ppa_image}" "native PPA image fallback marker applied" "ODK_LVGL_PPA_IMAGE_FALLBACK")
require_pattern("${native_ppa_image}" "native PPA image failure falls back to software" "lv_draw_sw_image(t, draw_dsc, img_coords);")

# PPA draws into one partial output stripe at a time. The foreground placeholder
# is backed by that stripe, so its dimensions and crop origin must be stripe
# local; using source-snapshot coordinates can address past the output buffer.
require_pattern("${native_patch}" "native PPA image partial-target marker" "ODK_LVGL_PPA_IMAGE_PARTIAL_TARGET")
require_pattern("${native_ppa_image}" "native PPA image partial-target marker applied" "ODK_LVGL_PPA_IMAGE_PARTIAL_TARGET")
require_pattern("${native_ppa_image}" "PPA foreground uses output stripe width" ".pic_w           = draw_buf->header.w")
require_pattern("${native_ppa_image}" "PPA foreground uses output stripe height" ".pic_h           = draw_buf->header.h")
require_pattern("${native_ppa_image}" "PPA foreground uses output stripe x" ".block_offset_x  = dest_area.x1")
require_pattern("${native_ppa_image}" "PPA foreground uses output stripe y" ".block_offset_y  = dest_area.y1")
forbid_pattern("${native_ppa_image}" "PPA foreground must not use source snapshot width" ".in_fg = {\n            .buffer          = (void *)dest_buf,\n            .pic_w           = draw_dsc->header.w")

# Snapshot capture calls esp_cache_msync before the PPA reads immutable
# RGB565 source pixels. Keep the owning component linked to esp_mm so a clean
# target build cannot silently lose the cache API declaration.
require_pattern("${lvgl_component_cmake}" "snapshot cache sync links esp_mm privately" "PRIV_REQUIRES\n        esp_mm")
