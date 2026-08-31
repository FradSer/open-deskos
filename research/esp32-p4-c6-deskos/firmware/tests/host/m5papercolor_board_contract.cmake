set(ODK_ROOT "${ODK_ROOT}")
set(BOARD_DIR "${ODK_ROOT}/application/open_deskos/boards/m5stack/m5papercolor")
set(VOICE_UI "${ODK_ROOT}/application/open_deskos/main/odk_voice_ui.c")
set(MAIN_C "${ODK_ROOT}/application/open_deskos/main/main.c")
set(DISPLAY_BRINGUP "${ODK_ROOT}/application/open_deskos/main/odk_m5paper_display_bringup.c")
set(EPD_DRIVER "${ODK_ROOT}/application/open_deskos/components/esp_lcd_m5paper_epd/src/esp_lcd_m5paper_epd.c")

foreach(path IN ITEMS
        "${BOARD_DIR}/board_info.yaml"
        "${BOARD_DIR}/board_devices.yaml"
        "${BOARD_DIR}/board_peripherals.yaml"
        "${BOARD_DIR}/sdkconfig.defaults.board"
        "${BOARD_DIR}/README.md"
        "${VOICE_UI}"
        "${MAIN_C}"
        "${DISPLAY_BRINGUP}"
        "${EPD_DRIVER}")
    if(NOT EXISTS "${path}")
        message(FATAL_ERROR "missing M5PaperColor board support input: ${path}")
    endif()
endforeach()

file(READ "${BOARD_DIR}/board_info.yaml" INFO)
foreach(pattern IN ITEMS "board: m5papercolor" "chip: esp32s3" "400x600")
    string(FIND "${INFO}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "board_info missing ${pattern}")
    endif()
endforeach()

file(READ "${BOARD_DIR}/board_peripherals.yaml" PERIPHERALS)
foreach(pattern IN ITEMS "sda: 3" "scl: 2" "mosi_io_num: 13" "sclk_io_num: 15")
    string(FIND "${PERIPHERALS}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "board_peripherals missing ${pattern}")
    endif()
endforeach()

file(READ "${BOARD_DIR}/sdkconfig.defaults.board" BOARD_DEFAULTS)
foreach(pattern IN ITEMS "CONFIG_IDF_TARGET=\"esp32s3\"" "CONFIG_ODK_BOARD_M5PAPERCOLOR=y" "CONFIG_LV_DEF_REFR_PERIOD=1000")
    string(FIND "${BOARD_DEFAULTS}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "sdkconfig.defaults.board missing ${pattern}")
    endif()
endforeach()

file(READ "${DISPLAY_BRINGUP}" DISPLAY_SOURCE)
foreach(pattern IN ITEMS
        "init_m5pm1"
        "M5PM1_I2C_ADDR"
        "esp_lcd_new_panel_m5paper_epd"
        "ODK_M5PAPER_H_RES"
        "ODK_M5PAPER_V_RES"
        "M5_BTN_LEFT GPIO_NUM_10"
        "M5_BTN_CENTER GPIO_NUM_9"
        "M5_BTN_RIGHT GPIO_NUM_1"
        "PWR_CFG 0x06"
        "return NULL;")
    string(FIND "${DISPLAY_SOURCE}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "M5Paper display bring-up missing ${pattern}")
    endif()
endforeach()

file(READ "${VOICE_UI}" VOICE_SOURCE)
string(REGEX MATCHALL "CONFIG_ODK_BOARD_M5PAPERCOLOR" VOICE_MATCHES "${VOICE_SOURCE}")
list(LENGTH VOICE_MATCHES VOICE_MATCH_COUNT)
if(VOICE_MATCH_COUNT LESS 2)
    message(FATAL_ERROR "expected at least 2 occurrences of CONFIG_ODK_BOARD_M5PAPERCOLOR in odk_voice_ui.c, found ${VOICE_MATCH_COUNT}")
endif()

file(READ "${MAIN_C}" MAIN_SOURCE)
string(REGEX MATCHALL "CONFIG_ODK_BOARD_M5PAPERCOLOR" MAIN_MATCHES "${MAIN_SOURCE}")
list(LENGTH MAIN_MATCHES MAIN_MATCH_COUNT)
if(MAIN_MATCH_COUNT LESS 1)
    message(FATAL_ERROR "expected at least 1 occurrence of CONFIG_ODK_BOARD_M5PAPERCOLOR in main.c, found ${MAIN_MATCH_COUNT}")
endif()

file(READ "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/aiodi.lua" AIODI_SOURCE)
foreach(pattern IN ITEMS "local paper_color = pw == 400 and ph == 600" "local gutter = paper_color and 24 or" "local safe_inset = paper_color and 24 or 0")
    string(FIND "${AIODI_SOURCE}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "PaperColor safe-area layout missing ${pattern}")
    endif()
endforeach()

file(READ "${ODK_ROOT}/components/lua_modules/lua_module_lvgl/lib/launcher.lua" LAUNCHER_SOURCE)
foreach(pattern IN ITEMS "get_button_events" "pager.go_page(current - 1, false)" "pager.go_page(current + 1, false)")
    string(FIND "${LAUNCHER_SOURCE}" "${pattern}" offset)
    if(offset EQUAL -1)
        message(FATAL_ERROR "PaperColor button navigation missing ${pattern}")
    endif()
endforeach()
