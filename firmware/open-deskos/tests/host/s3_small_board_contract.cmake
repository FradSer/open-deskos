set(ODK_ROOT "${ODK_ROOT}")
set(BOARD_DIR "${ODK_ROOT}/application/open_deskos/boards/waveshare/esp32_s3_touch_lcd_2_8")
set(AIODI "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/aiodi.lua")
set(WIDGET_ENGINE "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/core/widget_engine.lua")
set(VOICE_UI "${ODK_ROOT}/application/open_deskos/main/odk_voice_ui.c")

foreach(path IN ITEMS "${BOARD_DIR}/board_info.yaml" "${BOARD_DIR}/board_devices.yaml" "${BOARD_DIR}/board_peripherals.yaml" "${BOARD_DIR}/sdkconfig.defaults.board" "${BOARD_DIR}/README.md" "${AIODI}" "${WIDGET_ENGINE}" "${VOICE_UI}")
    if(NOT EXISTS "${path}")
        message(FATAL_ERROR "missing S3 board support input: ${path}")
    endif()
endforeach()

file(READ "${BOARD_DIR}/board_info.yaml" INFO)
foreach(pattern IN ITEMS "board: esp32_s3_touch_lcd_2_8" "chip: esp32s3" "240x320")
    string(FIND "${INFO}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "board_info missing ${pattern}")
    endif()
endforeach()

file(READ "${BOARD_DIR}/board_peripherals.yaml" PERIPHERALS)
foreach(pattern IN ITEMS "sda: 1" "scl: 3" "mosi_io_num: 45" "sclk_io_num: 40" "gpio_num: 5")
    string(FIND "${PERIPHERALS}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "board_peripherals missing ${pattern}")
    endif()
endforeach()

file(READ "${AIODI}" AIODI_SOURCE)
foreach(pattern IN ITEMS "local small_screen = pw <= 320 or ph <= 320" "small_screen and 2 or 3" "small_screen and 2 or 4")
    string(FIND "${AIODI_SOURCE}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "AIODI compact grid rule missing ${pattern}")
    endif()
endforeach()

file(READ "${WIDGET_ENGINE}" WIDGET_SOURCE)
string(FIND "${WIDGET_SOURCE}" "widget exceeds board grid" offset)
if(offset EQUAL -1)
    message(FATAL_ERROR "widget grid bounds guard missing")
endif()

file(READ "${VOICE_UI}" VOICE_SOURCE)
set(DISPLAY_BRINGUP "${ODK_ROOT}/application/open_deskos/main/odk_s3_display_bringup.c")
if(NOT EXISTS "${DISPLAY_BRINGUP}")
    message(FATAL_ERROR "S3 display bring-up source is missing")
endif()
file(READ "${DISPLAY_BRINGUP}" DISPLAY_SOURCE)
foreach(pattern IN ITEMS "CONFIG_IDF_TARGET_ESP32S3" "PANEL_IF_IO" "odk_s3_display_bringup")
    string(FIND "${VOICE_SOURCE}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "S3 voice UI path missing ${pattern}")
    endif()
endforeach()

foreach(pattern IN ITEMS
        "GPIO_PULLUP_DISABLE"
        "gpio_set_level(S3_LCD_PWR, 0)"
        "gpio_set_level(S3_LCD_PWR, 1)"
        "gpio_get_level(S3_LCD_PWR_KEY) == 0"
        ".duty = 500"
        "ledc_set_duty(S3_BL_LEDC_MODE, S3_BL_LEDC_CHANNEL, 500)")
    string(FIND "${DISPLAY_SOURCE}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "S3 power/backlight sequence missing ${pattern}")
    endif()
endforeach()
