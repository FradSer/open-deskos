#pragma once
#include <cstddef>
#include <cstdint>

namespace hydra {

// SoftAP captive-portal provisioning (WiFiManager glue). The phone joins the
// "Hydra-Setup" AP, the captive page scans networks and collects the home Wi-Fi
// credentials plus the MQTT broker address. Wi-Fi credentials persist in the
// radio's own NVS; the broker address is returned for ProvisioningStore.
class WifiPortal {
 public:
  // True when STA credentials are already stored in the radio's NVS.
  static bool hasStoredWifi();

  // Runs the blocking portal. mqttHost is in/out: the current value pre-fills
  // the form, the saved value replaces it. Returns true when Wi-Fi connected
  // with the new settings (caller persists the host and restarts); false on
  // timeout or failed connect (caller continues without the bridge).
  bool run(const char* apName, char* mqttHost, size_t cap, uint32_t timeoutMs);
};

}  // namespace hydra
