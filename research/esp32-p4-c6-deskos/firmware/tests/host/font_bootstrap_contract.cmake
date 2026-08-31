set(VOICE_UI_SOURCE "${ODK_ROOT}/application/open_deskos/main/odk_voice_ui.c")
set(LVGL_HEADER "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/src/lua_module_lvgl.h")
set(FONT_ROOT "${ODK_ROOT}/application/open_deskos/fatfs_image/storage/fonts")

foreach(path IN ITEMS "${VOICE_UI_SOURCE}" "${LVGL_HEADER}")
    if(NOT EXISTS "${path}")
        message(FATAL_ERROR "font bootstrap contract input is missing: ${path}")
    endif()
endforeach()

foreach(font IN ITEMS NotoSansSC-Regular.ttf Montserrat-Bold.ttf)
    if(NOT EXISTS "${FONT_ROOT}/${font}")
        message(FATAL_ERROR "font bootstrap asset is missing: ${FONT_ROOT}/${font}")
    endif()
endforeach()

file(READ "${VOICE_UI_SOURCE}" voice_ui)
file(READ "${LVGL_HEADER}" lvgl_header)

string(FIND "${lvgl_header}" "lua_module_lvgl_set_data_root" public_api)
if(public_api EQUAL -1)
    message(FATAL_ERROR "lua_module_lvgl must expose the direct-boot DATA-root setter")
endif()

string(FIND "${voice_ui}" "lua_module_lvgl_set_data_root" configure_call)
string(FIND "${voice_ui}" "luaL_requiref(L, \"lvgl\", luaopen_lvgl, 1)" open_call)
if(configure_call EQUAL -1 OR open_call EQUAL -1 OR configure_call GREATER open_call)
    message(FATAL_ERROR "direct shell boot must configure LVGL DATA before luaopen_lvgl")
endif()
