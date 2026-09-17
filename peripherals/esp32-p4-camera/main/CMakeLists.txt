idf_component_register(
  SRCS "p4_camera_main.c" "p4_sc2336.c" "p4_uvc_stream.c"
       "p4_usb_microphone.c" "usb_descriptors.c"
  INCLUDE_DIRS "."
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
