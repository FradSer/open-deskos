#include "sub_node/hal/wifi_creds.h"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <cstring>

namespace hydra {

bool WifiCreds::save(const char* ssid, const char* psk) {
  if (ssid == nullptr || ssid[0] == '\0') return false;
  wifi_config_t cfg{};
  strncpy(reinterpret_cast<char*>(cfg.sta.ssid), ssid, sizeof(cfg.sta.ssid) - 1);
  reinterpret_cast<char*>(cfg.sta.ssid)[sizeof(cfg.sta.ssid) - 1] = '\0';
  if (psk != nullptr) {
    strncpy(reinterpret_cast<char*>(cfg.sta.password), psk, sizeof(cfg.sta.password) - 1);
    reinterpret_cast<char*>(cfg.sta.password)[sizeof(cfg.sta.password) - 1] = '\0';
  }
  cfg.sta.channel = 0;  // any channel
  // AUTH_OPEN is 0; the radio picks the right auth mode from the beacon.
  return esp_wifi_set_config(WIFI_IF_STA, &cfg) == ESP_OK;
}

bool WifiCreds::hasCredentials() {
  wifi_config_t cfg{};
  if (esp_wifi_get_config(WIFI_IF_STA, &cfg) != ESP_OK) return false;
  return cfg.sta.ssid[0] != 0;
}

bool WifiCreds::connect(uint32_t timeoutMs) {
  // The radio must be in STA mode. The caller (OTA mode entry) switches the
  // mode; here we just begin + wait.
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin();  // use the stored config
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start >= timeoutMs) return false;
    delay(100);
  }
  return true;
}

}  // namespace hydra
