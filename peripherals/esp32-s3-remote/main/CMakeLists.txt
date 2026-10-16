set(ODK_COMMON_DIR "${CMAKE_CURRENT_LIST_DIR}/../../common")
set(ODK_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/odk_plugins")
set(ODK_MANIFESTS
  "${CMAKE_CURRENT_LIST_DIR}/plugins/display.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/touch.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/buffers.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/gesture.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/serial.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/surface.json"
)
if(NOT CMAKE_BUILD_EARLY_EXPANSION)
  file(MAKE_DIRECTORY "${ODK_GENERATED_DIR}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${ODK_MANIFESTS}
  "${CMAKE_CURRENT_LIST_DIR}/../../../tools/codegen_plugin_descriptor.py")
execute_process(
  COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/../../../tools/codegen_plugin_descriptor.py"
    "${ODK_GENERATED_DIR}/s3_plugins.h" "${ODK_GENERATED_DIR}/s3_plugins.c" ${ODK_MANIFESTS}
  RESULT_VARIABLE ODK_CODEGEN_RESULT
)
if(NOT ODK_CODEGEN_RESULT EQUAL 0)
  message(FATAL_ERROR "Remote plugin descriptor generation failed")
endif()

endif()

idf_component_register(
  SRCS "${ODK_GENERATED_DIR}/s3_plugins.c" "${ODK_COMMON_DIR}/odk_plugin_host.c" "remote_control.c" "remote_state_frame.c" "touchpad_gesture.c" "cst328_frame.c"
  INCLUDE_DIRS "." "${ODK_COMMON_DIR}" "${ODK_GENERATED_DIR}"
  REQUIRES esp_lcd esp_driver_gpio esp_driver_i2c esp_driver_ledc esp_driver_spi esp_driver_usb_serial_jtag esp_timer
)
