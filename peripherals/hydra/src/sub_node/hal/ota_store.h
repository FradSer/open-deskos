#pragma once
#include <cstdint>

namespace hydra {

// NVS persistence for a sub-node's running firmware version. Mirrors the main
// node's OtaStore but in a separate namespace so a dual-role device (none today)
// could track both. The sub-node compares an incoming OtaAnnounce.otaVersion
// against this to decide whether to apply the update (only a strictly higher
// version flashes).
class OtaStore {
 public:
  // 0 when nothing is stored (treated as version 0: any version >= 1 applies).
  static uint32_t loadVersion();
  static void saveVersion(uint32_t version);
};

// Last-seen OtaAnnounce seq, for anti-replay: a sub-node ignores an announce
// whose seq is not greater than the last one it acted on. Persisted so a reboot
// does not re-apply a stale announce replayed by the main node.
class OtaSeqStore {
 public:
  // 0 when nothing is stored (the first seq >= 1 applies).
  static uint32_t loadSeq();
  static void saveSeq(uint32_t seq);
};

}  // namespace hydra
