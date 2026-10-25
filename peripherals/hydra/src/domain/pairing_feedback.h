#pragma once

#include <cstdint>

namespace hydra {

// Pure blue-LED policy for sub-node pairing feedback. Manual pairing blinks,
// then confirms solid after a successful assignment; a remotely refreshed
// spotlight is lower priority and expires when the main node goes quiet.
struct PairingFeedbackConfig {
  uint32_t pairingTimeoutMs;
  uint32_t confirmationMs;
  uint32_t blinkHalfPeriodMs;
  uint32_t spotlightTimeoutMs;
};

class PairingFeedback {
 public:
  explicit PairingFeedback(PairingFeedbackConfig config = {30000U, 2000U, 125U, 3000U})
      : config_(config) {}

  void startManualPairing(uint32_t now) {
    pairing_ = true;
    pairStartedAt_ = now;
  }

  void cancelPairing() { pairing_ = false; }

  void confirmManualPairing(uint32_t now) {
    pairing_ = false;
    confirming_ = true;
    confirmedAt_ = now;
  }

  void setSpotlight(bool on, uint32_t now) {
    spotlight_ = on;
    if (on) spotlightAt_ = now;
  }

  bool pairingActive(uint32_t now) {
    expire(now);
    return pairing_;
  }

  bool ledOn(uint32_t now) {
    expire(now);
    if (pairing_) return (now / config_.blinkHalfPeriodMs) % 2 == 0;
    if (confirming_) return true;
    return spotlight_;
  }

 private:
  void expire(uint32_t now) {
    if (pairing_ && now - pairStartedAt_ >= config_.pairingTimeoutMs) pairing_ = false;
    if (confirming_ && now - confirmedAt_ >= config_.confirmationMs) confirming_ = false;
    if (spotlight_ && now - spotlightAt_ >= config_.spotlightTimeoutMs) spotlight_ = false;
  }

  PairingFeedbackConfig config_;
  bool pairing_ = false;
  uint32_t pairStartedAt_ = 0;
  bool confirming_ = false;
  uint32_t confirmedAt_ = 0;
  bool spotlight_ = false;
  uint32_t spotlightAt_ = 0;
};

}  // namespace hydra
