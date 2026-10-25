#pragma once

namespace hydra {

// Tracks whether an ESP OTA handle still needs esp_ota_abort(). The hardware
// calls remain in the HAL; this pure state makes ownership transitions testable.
class OtaSession {
 public:
  void begin() { active_ = true; }
  bool active() const { return active_; }

  // Transfers abort responsibility to the caller exactly once.
  bool takeForAbort() {
    if (!active_) return false;
    active_ = false;
    return true;
  }

  // esp_ota_end() succeeded, so no active OTA handle remains to abort.
  void finalize() { active_ = false; }

 private:
  bool active_ = false;
};

}  // namespace hydra
