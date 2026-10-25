#include "main_node/hal/wifi_portal.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <cstring>
#include <esp_wifi.h>

namespace hydra {

bool WifiPortal::hasStoredWifi() {
  WiFi.mode(WIFI_STA);  // esp_wifi must be initialized before reading its config
  wifi_config_t conf = {};
  if (esp_wifi_get_config(WIFI_IF_STA, &conf) != ESP_OK) return false;
  return conf.sta.ssid[0] != '\0';
}

bool WifiPortal::run(const char* apName, char* mqttHost, size_t cap, uint32_t timeoutMs) {
  WiFiManager wm;
  WiFiManagerParameter hostParam("mqtt", "MQTT broker (NAS IP)", mqttHost,
                                 static_cast<int>(cap) - 1);
  wm.addParameter(&hostParam);
  wm.setConfigPortalTimeout(timeoutMs / 1000);
  wm.setBreakAfterConfig(true);  // leave the portal after save even if connect failed

  Serial.printf("[portal] AP \"%s\" up -- join it and open http://192.168.4.1\n", apName);
  bool connected = wm.startConfigPortal(apName);
  if (connected) {
    snprintf(mqttHost, cap, "%s", hostParam.getValue());
    Serial.printf("[portal] saved: WiFi \"%s\", broker \"%s\"\n",
                  WiFi.SSID().c_str(), mqttHost);
  } else {
    Serial.println("[portal] closed without a connection (timeout or failed join)");
  }
  return connected;
}

}  // namespace hydra
