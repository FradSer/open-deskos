#pragma once
#include <cstdint>

namespace hydra {

// NVS persistence for the running firmware's OTA version number. The main node
// compares an incoming OtaCommand.version against this to decide whether to
// apply the update (only a strictly higher version flashes). Thin adapter over
// Preferences, same shape as ProvisioningStore.
class OtaStore {
 public:
  // 0 when nothing is stored (treated as version 0: any version >= 1 applies).
  uint32_t loadVersion();
  void saveVersion(uint32_t version);

  // The sub-node OTA anti-replay seq is an in-memory counter on the main node
  // (g_subOtaSeq), not persisted per-value here -- but it MUST survive a main
  // node reboot without going backwards, or a freshly-rebooted main node's
  // seq=1 looks like a replay to a sub-node that already saw a higher seq from
  // before the reboot. Persist the next seq to hand out.
  uint32_t loadNextSubOtaSeq();
  void saveNextSubOtaSeq(uint32_t seq);
};

}  // namespace hydra
