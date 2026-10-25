#pragma once

#include <cstddef>
#include <cstdint>

#include "domain/env_metrics.h"
#include "domain/desktop_control.h"
#include "domain/env_reading.h"
#include "domain/fleet_view.h"
#include "domain/timetable.h"
#include "main_node/app/fleet_roster.h"
#include "main_node/app/link_recovery.h"

namespace hydra {

class CompositeEnvSensor;
class EspNowTransport;
class FleetStore;
class MainClock;
class MainDisplay;
class MqttFleetBridge;
class MqttLink;
struct MqttPayload;
class OtaStore;
class OtaUpdater;
class ProvisioningStore;
class WifiPortal;

// Buttons are sampled by the M5 composition root once per loop before the
// application runtime consumes them.
struct MainButtonEvents {
  bool frontHeld = false;
  bool frontClicked = false;
  bool sideClicked = false;
  bool sideHeld = false;
  bool sideHolding = false;
  bool sideReleased = false;
};

struct MainRuntimeOutcome {
  bool restart = false;
};

struct MainDiagnosticIdentity {
  const char* firmwareVersion = "dev";
  const char* buildIdentity = "main-node-dev";
  const char* bootIdentity = "unknown";
  const char* resetReason = "unknown";
};

inline bool shouldMarkOtaValid(bool alreadyMarked, uint32_t now, uint32_t healthMs) {
  return !alreadyMarked && now >= healthMs;
}

inline bool isEnvironmentPublicationDue(uint32_t now, uint32_t lastPublication,
                                        uint32_t cadenceMs) {
  return now - lastPublication >= cadenceMs;
}

struct RemoteForceOwners {
  bool physical = false;
  bool mqtt = false;
  bool desktop = false;
};

inline bool mergeRemoteForceOwners(const RemoteForceOwners& owners) {
  return owners.physical || owners.mqtt || owners.desktop;
}

inline bool remoteForceCommandChanged(const RemoteForceOwners& before,
                                      const RemoteForceOwners& after) {
  return mergeRemoteForceOwners(before) != mergeRemoteForceOwners(after);
}

struct RemoteForceCommand {
  bool valid = false;
  uint8_t targetId = 0;
  bool on = false;
};

// Merges the two main-node sources before they become the sub-node's one remote
// owner bit. Its bounded target table mirrors MqttFleetBridge's fleet capacity.
class RemoteForceRegistry {
 public:
  RemoteForceCommand setMqtt(uint8_t targetId, bool on) { return set(targetId, 0, on); }
  RemoteForceCommand setPhysical(uint8_t targetId, bool on) { return set(targetId, 1, on); }

  RemoteForceCommand setDesktop(uint8_t targetId, bool on) { return set(targetId, 2, on); }
  bool isPhysical(uint8_t targetId) const {
    const Slot* slot = find(targetId); return slot && slot->owners.physical;
  }
  bool isForced(uint8_t targetId) const {
    const Slot* slot = find(targetId);
    return slot && mergeRemoteForceOwners(slot->owners);
  }

 private:
  struct Slot {
    uint8_t targetId = 0;
    RemoteForceOwners owners{};
  };

  const Slot* find(uint8_t targetId) const {
    for (int i = 0; i < count_; i++) {
      if (slots_[i].targetId == targetId) return &slots_[i];
    }
    return nullptr;
  }

  Slot* findOrCreate(uint8_t targetId) {
    for (int i = 0; i < count_; i++) {
      if (slots_[i].targetId == targetId) return &slots_[i];
    }
    if (targetId == 0 || count_ >= FleetRoster::kMaxNodes) return nullptr;
    slots_[count_].targetId = targetId;
    return &slots_[count_++];
  }

  RemoteForceCommand set(uint8_t targetId, uint8_t owner, bool on) {
    Slot* slot = findOrCreate(targetId);
    if (!slot) return {};
    RemoteForceOwners before = slot->owners;
    if (owner == 1) {
      slot->owners.physical = on;
    } else if (owner == 2) {
      slot->owners.desktop = on;
    } else {
      slot->owners.mqtt = on;
    }
    if (!remoteForceCommandChanged(before, slot->owners)) return {};
    return {true, targetId, mergeRemoteForceOwners(slot->owners)};
  }

  Slot slots_[FleetRoster::kMaxNodes] = {};
  int count_ = 0;
};

inline FleetViewState applyMainButtonEvents(FleetViewState view, const MainButtonEvents& events) {
  if (events.frontHeld) {
    view = onFrontLong(view);
  } else if (events.frontClicked) {
    view = onFrontShort(view);
  }
  if (events.sideClicked) view = onSide(view);
  return view;
}

// Coordinates the main-node application. The composition root owns hardware
// construction, M5 event sampling, and restart lifecycle; this class owns the
// dashboard, roster, pairing, environment, MQTT, and OTA application state.
class HostTelemetryPublisher;
class MainRuntime {
 public:
  MainRuntime(CompositeEnvSensor& env, MainDisplay& display, EspNowTransport& transport,
              FleetStore& fleetStore, MqttLink& mqtt, MainClock& clock, MqttFleetBridge& mqttBridge,
              ProvisioningStore& provisioningStore, WifiPortal& wifiPortal, OtaUpdater& otaUpdater,
              OtaStore& otaStore, MainDiagnosticIdentity diagnosticIdentity);

  void attachDesktopControl(DesktopControl* control) { desktopControl_ = control; }
  void attachHostTelemetry(HostTelemetryPublisher* publisher) { hostTelemetry_ = publisher; }
  MainRuntimeOutcome provision(bool bootSidePressed);
  MainRuntimeOutcome begin(bool environmentBusReady, uint32_t now);
  MainRuntimeOutcome tick(uint32_t now, const MainButtonEvents& buttons);

 private:
  void serviceDesktopControl(uint32_t now);
  void queueControlReply(const uint8_t reply[128], uint32_t now);
  void logReading(const EnvReading& reading) const;
  void broadcastEnv(const EnvMetrics& metrics);
  uint8_t mainChannel() const;
  void publishSubOtaProgress(const char* status);
  void publishMqttPayloads(const struct MqttPayload* payloads, int count);
  void publishEnvironment();
  void publishSubNodeMqttState(uint32_t now);
  void publishDiagnostics(uint32_t now);
  MainRuntimeOutcome serviceConnectivityRecovery(uint32_t now);
  bool restartRadioSafely();
  bool serviceMqtt(uint32_t now);
  bool runSetupPortal(char* host, size_t cap);
  void renderView();
  bool handleButtons(const MainButtonEvents& buttons, bool& dirty);
  void handleRemoteForcePump(uint32_t now, const MainButtonEvents& buttons, bool& dirty);
  void applyMqttForce(uint8_t targetId, bool on);
  void setPhysicalForce(uint8_t targetId, bool on);
  bool drainEspNowFrames(uint32_t now, bool& dirty);
  void updateSpotlightNode(uint32_t now);
  void initializeEnvironment(uint32_t now);
  void sendPumpCommand(uint8_t targetId, bool on);
  void sendTimetable(uint8_t targetId, const Timetable& table);
  void publishTimetableAck(uint8_t nodeId, const Timetable& table);
  void sendSpotlight(uint8_t targetId, bool on);
  void broadcastPairAssign(const uint8_t mac[6], uint8_t id);
  void sendPskDelivery(const uint8_t mac[6]);

  CompositeEnvSensor& env_;
  MainDisplay& display_;
  EspNowTransport& transport_;
  FleetStore& fleetStore_;
  MqttLink& mqtt_;
  MainClock& clock_;
  MqttFleetBridge& mqttBridge_;
  ProvisioningStore& provisioningStore_;
  WifiPortal& wifiPortal_;
  OtaUpdater& otaUpdater_;
  OtaStore& otaStore_;
  MainDiagnosticIdentity diagnosticIdentity_;
  DesktopControl* desktopControl_ = nullptr;
  uint8_t controlReply_[128]{};
  bool controlReplyPending_ = false;
  uint32_t controlReplyAt_ = 0, lastDesktopRefresh_ = 0;
  HostTelemetryPublisher* hostTelemetry_ = nullptr;
  LinkRecovery linkRecovery_;
  FleetRoster roster_;
  FleetViewState view_;
  EnvReading reading_{};
  EnvMetrics metrics_{};
  uint32_t lastRefresh_ = 0;
  uint32_t lastEnvBroadcast_ = 0;
  uint32_t lastEnvPublication_ = 0;
  uint32_t lastNodeMqttHeartbeat_ = 0;
  uint32_t lastDiagnosticHeartbeat_ = 0;
  uint32_t lastLog_ = 0;
  bool envReady_ = false;
  uint8_t justPaired_ = 0;
  RemoteForceRegistry forceRegistry_;
  uint8_t physicalForceTarget_ = 0;
  uint32_t lastForceMs_ = 0;
  uint8_t viewedNode_ = 0;
  uint32_t lastSpotlightMs_ = 0;
  uint32_t subOtaSeq_ = 1;
  bool mqttEnabled_ = false;
  bool hasWifi_ = false;
  bool hasMqttHost_ = false;
  char mqttHost_[40] = {};
};

}  // namespace hydra
