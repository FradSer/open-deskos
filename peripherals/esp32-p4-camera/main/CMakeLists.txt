set(ODK_COMMON_DIR "${CMAKE_CURRENT_LIST_DIR}/../../common")
set(ODK_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/odk_plugins")
set(ODK_MANIFESTS
  "${CMAKE_CURRENT_LIST_DIR}/plugins/storage.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/i2c.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/camera.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/usb.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/microphone.json"
  "${CMAKE_CURRENT_LIST_DIR}/plugins/stream.json"
)
if(NOT CMAKE_BUILD_EARLY_EXPANSION)
  file(MAKE_DIRECTORY "${ODK_GENERATED_DIR}")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${ODK_MANIFESTS}
    "${CMAKE_CURRENT_LIST_DIR}/../../../tools/codegen_plugin_descriptor.py")
  execute_process(
    COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/../../../tools/codegen_plugin_descriptor.py"
      "${ODK_GENERATED_DIR}/p4_plugins.h" "${ODK_GENERATED_DIR}/p4_plugins.c" ${ODK_MANIFESTS}
    RESULT_VARIABLE ODK_P4_RESULT)
  if(NOT ODK_P4_RESULT EQUAL 0)
    message(FATAL_ERROR "P4 plugin descriptor generation failed")
  endif()
endif()

idf_component_register(
  SRCS "${ODK_GENERATED_DIR}/p4_plugins.c" "${ODK_COMMON_DIR}/odk_plugin_host.c" "p4_usb_transport.c" "p4_camera_main.c" "p4_sc2336.c" "p4_uvc_stream.c"
       "p4_usb_microphone.c" "usb_descriptors.c"
  INCLUDE_DIRS "." "${ODK_COMMON_DIR}" "${ODK_GENERATED_DIR}"
  REQUIRES esp_video esp_driver_gpio esp_driver_i2c esp_driver_i2s esp_tinyusb
           usb_device_uac esp_codec_dev esp_mm nvs_flash
)

idf_component_get_property(tusb_lib espressif__tinyusb COMPONENT_LIB)
idf_component_get_property(esp_tinyusb_dir espressif__esp_tinyusb COMPONENT_DIR)
idf_component_get_property(uac_lib espressif__usb_device_uac COMPONENT_LIB)
idf_component_get_property(uac_dir espressif__usb_device_uac COMPONENT_DIR)
target_include_directories(${tusb_lib} BEFORE PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${esp_tinyusb_dir}/include"
  "${uac_dir}/tusb_uac"
)
target_include_directories(${uac_lib} PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${esp_tinyusb_dir}/include"
  "${uac_dir}/tusb_uac"
)

# Extend the reviewed upstream source in the build directory only.
set(ODK_UAC_SOURCE "${uac_dir}/usb_device_uac.c")
set(ODK_UAC_GENERATED "${CMAKE_CURRENT_BINARY_DIR}/odk_usb_device_uac.c")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${ODK_UAC_SOURCE}" "${CMAKE_CURRENT_LIST_DIR}/../../../tools/extend_uac_lifecycle.py")
execute_process(
  COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/../../../tools/extend_uac_lifecycle.py"
    "${ODK_UAC_SOURCE}" "${ODK_UAC_GENERATED}"
  RESULT_VARIABLE ODK_UAC_RESULT
)
if(NOT ODK_UAC_RESULT EQUAL 0)
  message(FATAL_ERROR "UAC lifecycle source extension failed")
endif()
get_target_property(ODK_UAC_SOURCES ${uac_lib} SOURCES)
list(FILTER ODK_UAC_SOURCES EXCLUDE REGEX "(^|/)usb_device_uac\\.c$")
set_property(TARGET ${uac_lib} PROPERTY SOURCES ${ODK_UAC_SOURCES} "${ODK_UAC_GENERATED}")

# Keep video receive cancellation inside the reviewed video component build.
idf_component_get_property(video_lib espressif__esp_video COMPONENT_LIB)
idf_component_get_property(video_dir espressif__esp_video COMPONENT_DIR)
set(ODK_VIDEO_OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/video-lifecycle")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${video_dir}/src/esp_video.c" "${video_dir}/src/esp_video_ioctl.c" "${video_dir}/src/esp_video_init.c"
  "${CMAKE_CURRENT_LIST_DIR}/../../../tools/extend_video_lifecycle.py")
execute_process(
  COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/../../../tools/extend_video_lifecycle.py"
    "${video_dir}/src" "${ODK_VIDEO_OUTPUT}"
  RESULT_VARIABLE ODK_VIDEO_RESULT
)
if(NOT ODK_VIDEO_RESULT EQUAL 0)
  message(FATAL_ERROR "Video lifecycle source extension failed")
endif()
get_target_property(ODK_VIDEO_SOURCES ${video_lib} SOURCES)
list(FILTER ODK_VIDEO_SOURCES EXCLUDE REGEX "(^|/)esp_video(_ioctl|_init)?\\.c$")
set_property(TARGET ${video_lib} PROPERTY SOURCES ${ODK_VIDEO_SOURCES}
  "${ODK_VIDEO_OUTPUT}/odk_esp_video.c" "${ODK_VIDEO_OUTPUT}/odk_esp_video_ioctl.c"
  "${ODK_VIDEO_OUTPUT}/odk_esp_video_init.c"
  "${CMAKE_CURRENT_LIST_DIR}/p4_video_lifecycle.c")
target_include_directories(${video_lib} PRIVATE "${CMAKE_CURRENT_LIST_DIR}")

# Preserve cooperative USB task exit and retry state in reviewed SDK sources.
idf_component_get_property(esp_tinyusb_lib espressif__esp_tinyusb COMPONENT_LIB)
idf_component_get_property(tinyusb_dir espressif__tinyusb COMPONENT_DIR)
set(ODK_TINYUSB_OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/tinyusb-lifecycle")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${esp_tinyusb_dir}/tinyusb.c" "${esp_tinyusb_dir}/tinyusb_task.c"
  "${tinyusb_dir}/src/device/usbd.c"
  "${CMAKE_CURRENT_LIST_DIR}/../../../tools/extend_tinyusb_lifecycle.py")
execute_process(
  COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/../../../tools/extend_tinyusb_lifecycle.py"
    "${esp_tinyusb_dir}" "${tinyusb_dir}/src/device" "${ODK_TINYUSB_OUTPUT}"
  RESULT_VARIABLE ODK_TINYUSB_RESULT)
if(NOT ODK_TINYUSB_RESULT EQUAL 0)
  message(FATAL_ERROR "TinyUSB lifecycle source extension failed")
endif()
get_target_property(ODK_TINYUSB_WRAPPER_SOURCES ${esp_tinyusb_lib} SOURCES)
list(FILTER ODK_TINYUSB_WRAPPER_SOURCES EXCLUDE REGEX "(^|/)tinyusb(_task)?\\.c$")
set_property(TARGET ${esp_tinyusb_lib} PROPERTY SOURCES ${ODK_TINYUSB_WRAPPER_SOURCES}
  "${ODK_TINYUSB_OUTPUT}/odk_tinyusb.c" "${ODK_TINYUSB_OUTPUT}/odk_tinyusb_task.c")
get_target_property(ODK_TINYUSB_CORE_SOURCES ${tusb_lib} SOURCES)
list(FILTER ODK_TINYUSB_CORE_SOURCES EXCLUDE REGEX "(^|/)usbd\\.c$")
set_property(TARGET ${tusb_lib} PROPERTY SOURCES ${ODK_TINYUSB_CORE_SOURCES}
  "${ODK_TINYUSB_OUTPUT}/odk_usbd.c")
