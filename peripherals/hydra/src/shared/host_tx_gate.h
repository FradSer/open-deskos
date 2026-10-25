#pragma once
#include <atomic>
#include <cstdint>
namespace hydra {
// Telemetry alone waits for callbacks. A missing callback never queues fleet control.
class HostTxGate {
 public:
  void fleetStart() { fleet_.fetch_add(1); }
  void fleetComplete() {
    uint32_t n = fleet_.load();
    while (n && !fleet_.compare_exchange_weak(n, n - 1)) {
    }
  }
  bool hostStart(uint32_t now) {
    if (pending_.load() && now - startedAt_ >= 500) failed_ = true;
    if (failed_ || fleet_.load() || pending_.exchange(true)) return false;
    startedAt_ = now;
    return true;
  }
  void hostRejected() { pending_.store(false); }
  void hostComplete() { pending_.store(false); }
  void reset() {
    fleet_.store(0);
    pending_.store(false);
    failed_ = false;
  }

 private:
  std::atomic<uint32_t> fleet_{0};
  std::atomic<bool> pending_{false};
  uint32_t startedAt_ = 0;
  bool failed_ = false;
};
}  // namespace hydra
