idf_component_register(SRCS "gateway.c" "gateway_line.c" INCLUDE_DIRS "."
  PRIV_REQUIRES esp_wifi esp_event esp_netif nvs_flash esp_driver_usb_serial_jtag json mbedtls esp_hw_support)
