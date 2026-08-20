# main/idf_component.yml declares the local path deps (app_claw, app_config,
# wifi_manager, http_server, captive_dns, odk_* platform components, etc.)
# which the component manager turns into this component's REQUIRES. The headers
# below are not reachable through those transitive includes, so declare them
# explicitly here:
#   esp_app_format  -> esp_app_desc.h (open_deskos_version.c)
#   cmd_wifi        -> cmd_wifi.h (main.c CLI registration)
#   esp_lcd_st7701  -> esp_lcd_st7701.h (odk_display_bringup.c)
#   esp_lcd         -> esp_lcd_panel_*.h / esp_lcd_mipi_dsi.h / SPI panel drivers
#   esp_driver_ledc -> driver/ledc.h (backlight PWM)
#   esp_lcd_touch_gt911 / esp_lcd_touch -> GT911 (odk_touch_bringup.c)
#   espressif__esp_hosted -> esp_hosted_ota.h (odk_c6_slave_ota.c)
# Note: cap_im_platform (-> cap_im_wechat.h in main.c) is a conditional path
# dep and is declared in main/idf_component.yml, not here — IDF 6.0's component
# manager does not expose conditionally-registered components as PRIV_REQUIRES
# targets (resolves to "unknown name").
#
# network_adapter.bin (copied into this directory) is the matching C6 slave
# image. Embedded so we can upgrade the factory C6 over SDIO without the
# board's #4 USB port — see odk_c6_slave_ota.c. Rebuild the slave first if
# missing: cd ../managed_components/espressif__esp_hosted/slave && idf.py
# set-target esp32c6 && idf.py build && cp build/network_adapter.bin ../../main/
if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/network_adapter.bin")
    message(FATAL_ERROR
        "main/network_adapter.bin missing. Build the C6 slave and copy it here.")
endif()

file(GLOB ODK_MAIN_SRCS "*.c")
if(CONFIG_IDF_TARGET_ESP32S3)
    list(FILTER ODK_MAIN_SRCS EXCLUDE REGEX "/odk_display_bringup\\.c$")
    list(FILTER ODK_MAIN_SRCS EXCLUDE REGEX "/odk_touch_bringup\\.c$")
else()
    list(FILTER ODK_MAIN_SRCS EXCLUDE REGEX "/odk_s3_display_bringup\\.c$")
endif()

idf_component_register(
    SRCS ${ODK_MAIN_SRCS}
    INCLUDE_DIRS "."
    PRIV_INCLUDE_DIRS
        "${CMAKE_CURRENT_LIST_DIR}/../managed_components/espressif__esp_hosted/host"
        "${CMAKE_CURRENT_LIST_DIR}/../managed_components/espressif__esp_hosted/host/api/include"
        "${IDF_PATH}/components/esp_lcd/dsi/include"
    PRIV_REQUIRES esp_app_format cmd_wifi esp_lcd_st7701 esp_lcd esp_driver_ledc
                  esp_lcd_touch esp_lcd_touch_gt911 espressif__esp_hosted
                  esp_driver_spi esp_driver_i2c
                  esp_driver_usb_serial_jtag
                  odk_espnow_validator
                  lua_module_lvgl
    EMBED_FILES "network_adapter.bin"
)
