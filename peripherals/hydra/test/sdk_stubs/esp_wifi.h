#pragma once
#include <cstdint>
constexpr int ESP_OK = 0, WIFI_SECOND_CHAN_NONE = 0, WIFI_IF_STA = 0, WIFI_STORAGE_RAM = 1;
struct wifi_config_t { uint8_t opaque[256] = {}; };
inline int esp_wifi_set_storage(int) { return ESP_OK; }
inline int esp_wifi_set_config(int, const wifi_config_t*) { return ESP_OK; }
inline int esp_wifi_set_channel(uint8_t, int) { return ESP_OK; }
inline void esp_wifi_get_mac(int, uint8_t out[6]) { out[0] = 2; }
