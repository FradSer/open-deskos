#pragma once
#include "domain/plan_install_receipt.h"

#include <cstdint>

#include "domain/button_guard.h"
#include "domain/channel_scan.h"
#include "domain/fleet_message.h"
#include "domain/pairing_feedback.h"
#include "domain/pump_status.h"
#include "sub_node/app/irrigation_config.h"
#include "sub_node/app/irrigation_controller.h"
#include "sub_node/app/sub_runtime_config.h"

class Adafruit_NeoPixel;

namespace hydra {

class EspNowTransport;
class OtaWriter;
class WireClock;

struct SubButtonEvents {
  bool pressed = false;
  bool singleClicked = false;
  bool hold = false;
  bool released = false;
};

struct SubRuntimeOutcome {
  bool restart = false;
};

inline bool shouldMarkSubOtaValid(bool alreadyMarked, uint32_t now, uint32_t healthMs) {
  return !alreadyMarked && now >= healthMs;
}

inline bool shouldReleaseEspNowBeforeOta(bool hasWiFiCredentials) {
  return hasWiFiCredentials;
}

inline bool shouldReinitializeRadioAfterOta(bool radioWasTornDown, bool transferSucceeded) {
  return radioWasTornDown && !transferSucceeded;
}

inline bool shouldTearDownWiFiBeforeOtaRestart(bool radioWasTornDown, bool transferSucceeded) {
  return radioWasTornDown && transferSucceeded;
}

inline bool isEnvironmentStale(uint32_t now, uint32_t lastEnvAt, uint32_t staleMs) {
  return now - lastEnvAt >= staleMs;
}

inline bool isRemoteForceStale(uint32_t now, uint32_t forcedAt, uint32_t timeoutMs) {
  return now - forcedAt >= timeoutMs;
}

// Coordinates sub-node irrigation, pairing, fleet radio state, telemetry, LED
// feedback, and OTA application flow. The composition root owns NanoC6 event
// sampling, physical adapter construction/radio initialization, and restart.
class SubRuntime {
 public:
  SubRuntime(IWateringZone** zones, int zoneCount, WireClock& clock, EspNowTransport& transport,
             OtaWriter& otaWriter, Adafruit_NeoPixel& strip);

  uint8_t bootChannel() const;
  void begin(uint8_t bootChannel, const uint8_t mac[6], bool radioReady, uint32_t now);
  SubRuntimeOutcome tick(uint32_t now, const SubButtonEvents& buttons);

 private:
  bool isMainFrame(uint8_t type) const;
  void enterPairing(uint32_t now);
  void broadcastPairRequest();
  void broadcastStatus();
  void updateRgbLed(const SoilReading& soil);
  SubRuntimeOutcome runOta(uint32_t now);
  void handleButtonEvents(uint32_t now, const SubButtonEvents& buttons);
  void handlePeriodicTick(uint32_t now);
  SubRuntimeOutcome handleFrame(const FleetMessage& frame, uint32_t now);
  void updateBlueLed(uint32_t now);
  void serviceChannelScan(uint32_t now);
  void setBlueLed(bool on);

  PlanInstallReceipt planInstallReceipt_;
  WireClock& clock_;
  EspNowTransport& transport_;
  OtaWriter& otaWriter_;
  Adafruit_NeoPixel& strip_;
  IrrigationController controller_;
  ChannelScanState scan_;
  PairingFeedback pairingFeedback_;
  ButtonArmState bootButton_;
  uint8_t mac_[6] = {};
  uint8_t nodeId_ = 0;
  uint32_t lastTick_ = 0;
  uint32_t lastDraw_ = 0;
  uint32_t lastStatus_ = 0;
  uint32_t lastPairRequest_ = 0;
  uint32_t remoteForceAt_ = 0;
  uint32_t lastEnvAt_ = 0;
  bool bootReconfigureStarted_ = false;
  bool manualForce_ = false;
  bool remoteForce_ = false;
  bool otaMode_ = false;
  RemoteEnv remoteEnv_ = defaultRemoteEnv();
  uint32_t firmwareVersion_ = 0;
  uint32_t pendingOtaVersion_ = 0;
  uint32_t pendingOtaSize_ = 0;
  uint8_t pendingOtaSha_[32] = {};
  uint8_t pendingOtaIp_[4] = {};
  uint16_t pendingOtaPort_ = 0;
};

}  // namespace hydra
