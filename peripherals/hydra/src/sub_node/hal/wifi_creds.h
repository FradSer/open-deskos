#pragma once
#include <cstdint>

namespace hydra {

// NVS persistence for the home Wi-Fi SSID + PSK delivered to a sub-node at
// pairing (via a PskDelivery frame). The sub-node uses these to join the home
// network during a sub-node OTA so it can HTTP-GET the firmware bin from the
// NAS itself (the main node cannot relay a 1MB bin: its heap is too small and
// its single STA cannot be on two networks at once).
//
// Stored in the radio's own NVS via esp_wifi_set_config so a plain WiFi.begin()
// (no args) later re-associates to the saved network -- the same pattern the
// main node uses after its captive-portal provisioning.
class WifiCreds {
 public:
  // Store SSID + PSK into the radio's STA config so WiFi.begin() (no args)
  // re-associates. Returns false if the radio call fails.
  static bool save(const char* ssid, const char* psk);

  // True if a non-empty SSID is stored.
  static bool hasCredentials();

  // Associate to the stored network. Blocking up to timeoutMs. Returns true on
  // WL_CONNECTED.
  static bool connect(uint32_t timeoutMs);
};

}  // namespace hydra
