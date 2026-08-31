idf_component_register(
  SRCS "remote_control.c"
  INCLUDE_DIRS "."
  REQUIRES esp_lcd esp_driver_gpio esp_driver_i2c esp_driver_ledc esp_driver_spi esp_tinyusb esp_timer
)
