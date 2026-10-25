#pragma once
#include <cstdint>

namespace hydra {

// Persists a sub-node's assigned fleet id and last-known fleet channel in NVS so
// they survive reboots. id 0 means unprovisioned (never paired). The channel lets
// a paired node boot straight onto the main node's channel instead of sweeping.
// Static -- there is one identity per device.
class NodeIdentity {
 public:
  static uint8_t load();      // 0 if never paired
  static void save(uint8_t id);
  static uint8_t loadChannel(uint8_t fallback);  // fallback if never saved
  static void saveChannel(uint8_t channel);
};

}  // namespace hydra
