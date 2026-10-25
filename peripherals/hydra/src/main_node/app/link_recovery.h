#pragma once

#include <cstdint>

namespace hydra {

enum class LinkRecoveryAction {
  None,
  NudgeWifi,
  RestartRadio,
  RestartDevice,
};

struct LinkRecoveryConfig {
  uint32_t wifiNudgeMs;
  uint32_t radioRestartMs;
  uint32_t deviceRestartMs;
};

// Pure bounded recovery state machine for the main node's Wi-Fi/MQTT path.
// A healthy broker session is the recovery target: Wi-Fi alone is insufficient
// because the device's remote health and OTA control plane both require MQTT.
class LinkRecovery {
 public:
  explicit LinkRecovery(LinkRecoveryConfig config) : config_(config) {}

  LinkRecoveryAction tick(uint32_t now, bool wifiConnected, bool mqttConnected) {
    if (wifiConnected && mqttConnected) {
      reset();
      return LinkRecoveryAction::None;
    }

    if (!outageActive_) startOutage(now);

    uint32_t outageMs = now - outageStartedMs_;
    if (!deviceRestartRequested_ && outageMs >= config_.deviceRestartMs) {
      deviceRestartRequested_ = true;
      return LinkRecoveryAction::RestartDevice;
    }
    if (!radioRestartRequested_ && outageMs >= config_.radioRestartMs) {
      radioRestartRequested_ = true;
      return LinkRecoveryAction::RestartRadio;
    }
    if (!wifiNudgeRequested_ && outageMs >= config_.wifiNudgeMs) {
      wifiNudgeRequested_ = true;
      return LinkRecoveryAction::NudgeWifi;
    }
    return LinkRecoveryAction::None;
  }

 private:
  void startOutage(uint32_t now) {
    outageStartedMs_ = now;
    outageActive_ = true;
  }

  void reset() {
    outageActive_ = false;
    wifiNudgeRequested_ = false;
    radioRestartRequested_ = false;
    deviceRestartRequested_ = false;
  }

  LinkRecoveryConfig config_;
  uint32_t outageStartedMs_ = 0;
  bool outageActive_ = false;
  bool wifiNudgeRequested_ = false;
  bool radioRestartRequested_ = false;
  bool deviceRestartRequested_ = false;
};

}  // namespace hydra
