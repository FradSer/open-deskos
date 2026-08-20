cmake_minimum_required(VERSION 3.16)

# Build from the ESP-Hosted slave checkout after copying the tracked bridge
# sources into its main component. This wrapper is intentionally not a second
# slave implementation; the managed ESP-Hosted project remains the baseline.
set(ESP_HOSTED_SLAVE_DIR "${CMAKE_CURRENT_LIST_DIR}/../open_deskos/managed_components/espressif__esp_hosted/slave")
if(NOT EXISTS "${ESP_HOSTED_SLAVE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "ESP-Hosted slave checkout is missing")
endif()
include("${ESP_HOSTED_SLAVE_DIR}/CMakeLists.txt")
