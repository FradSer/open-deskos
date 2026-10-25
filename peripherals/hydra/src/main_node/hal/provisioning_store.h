#pragma once
#include <cstddef>

namespace hydra {

// NVS persistence for the provisioned MQTT broker address (the Wi-Fi credentials
// live in the radio's own NVS, written by the portal). Same thin-adapter shape as
// NodeIdentity/FleetStore.
class ProvisioningStore {
 public:
  // Loads the stored broker address into out. False when nothing is stored.
  bool loadHost(char* out, size_t cap);
  void saveHost(const char* host);
};

}  // namespace hydra
