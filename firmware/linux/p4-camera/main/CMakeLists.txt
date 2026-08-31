idf_component_register(
  SRCS "p4_camera_main.c" "p4_sc2336.c" "p4_camera_protocol.c" "p4_face_inference.cpp"
  INCLUDE_DIRS "."
  REQUIRES esp_video esp_driver_gpio esp_driver_i2c esp_driver_uart esp_tinyusb cjson esp_mm fatfs wear_levelling nvs_flash human_face_detect human_face_recognition
)
