#pragma once
#include <cstdint>
#include <cstring>

namespace hydra {

// Pure provisioning decisions for the main node -- no Arduino, host-tested. The
// portal itself (SoftAP + captive web form) is thin HAL glue in hal/wifi_portal.

enum class BootMode : uint8_t {
  Normal,  // provisioned: dashboard + HomeKit bridge
  Setup,   // run the captive portal first
};

// Setup runs when anything is missing or the user asked for it (side button held
// at power-on). Watering never depends on this -- sub-nodes are autonomous.
inline BootMode decideBootMode(bool provisioned, bool setupRequested) {
  return (setupRequested || !provisioned) ? BootMode::Setup : BootMode::Normal;
}

// Trims surrounding whitespace in place. Returns false when nothing usable is
// left -- an empty broker address means "no HomeKit bridge", never a crash.
inline bool sanitizeMqttHost(char* host) {
  if (host == nullptr) return false;
  char* start = host;
  while (*start == ' ' || *start == '\t') start++;
  size_t len = strlen(start);
  while (len > 0 && (start[len - 1] == ' ' || start[len - 1] == '\t' ||
                     start[len - 1] == '\r' || start[len - 1] == '\n')) {
    len--;
  }
  memmove(host, start, len);
  host[len] = '\0';
  return len > 0;
}

}  // namespace hydra
