#include "main_node/app/main_runtime.h"

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>

#include <cstring>

#include "domain/fleet_codec.h"
#include "domain/fleet_message.h"
#include "domain/pump_status.h"
#include "main_node/app/host_telemetry.h"
#include "main_node/app/main_display.h"
#include "main_node/app/mqtt_bridge.h"
#include "main_node/app/nas_url.h"
#include "main_node/app/ota.h"
#include "main_node/app/provisioning.h"
#include "main_node/config.h"
#include "main_node/hal/composite_env_sensor.h"
#include "main_node/hal/fleet_store.h"
#include "main_node/hal/main_clock.h"
#include "main_node/hal/mqtt_link.h"
#include "main_node/hal/ota_store.h"
#include "main_node/hal/ota_updater.h"
#include "main_node/hal/provisioning_store.h"
#include "main_node/hal/wifi_portal.h"
#include "shared/esp_now_transport.h"

namespace hydra {

MainRuntime::MainRuntime(CompositeEnvSensor& env, MainDisplay& display, EspNowTransport& transport,
                         FleetStore& fleetStore, MqttLink& mqtt, MainClock& clock,
                         MqttFleetBridge& mqttBridge, ProvisioningStore& provisioningStore,
                         WifiPortal& wifiPortal, OtaUpdater& otaUpdater, OtaStore& otaStore,
                         MainDiagnosticIdentity diagnosticIdentity)
    : env_(env),
      display_(display),
      transport_(transport),
      fleetStore_(fleetStore),
      mqtt_(mqtt),
      clock_(clock),
      mqttBridge_(mqttBridge),
      provisioningStore_(provisioningStore),
      wifiPortal_(wifiPortal),
      otaUpdater_(otaUpdater),
      otaStore_(otaStore),
      diagnosticIdentity_(diagnosticIdentity),
      linkRecovery_(
          {config::kWifiNudgeMs, config::kWifiRestartMs, config::kConnectivityRestartMs}) {}

MainRuntimeOutcome MainRuntime::provision(bool bootSidePressed) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)bootSidePressed;
  return {};
#else
  hasMqttHost_ =
      provisioningStore_.loadHost(mqttHost_, sizeof(mqttHost_)) && sanitizeMqttHost(mqttHost_);
  hasWifi_ = WifiPortal::hasStoredWifi();
  if (decideBootMode(hasWifi_, bootSidePressed) == BootMode::Setup) {
    if (runSetupPortal(mqttHost_, sizeof(mqttHost_))) return {true};
    hasWifi_ = false;
  }
  return {};
#endif
}

MainRuntimeOutcome MainRuntime::begin(bool environmentBusReady, uint32_t now) {
  display_.renderEnv(metrics_);
  fleetStore_.load(roster_);
  Serial.printf("[main-node] roster: %d paired node(s)\n", roster_.count());
  subOtaSeq_ = otaStore_.loadNextSubOtaSeq();

#ifndef HYDRA_DESKTOP_TELEMETRY
  if (hasWifi_ && hasMqttHost_) {
    mqtt_.begin(mqttHost_, config::kMqttPort, config::kMqttClientId, config::kMqttReconnectMs);
    mqttEnabled_ = true;
    Serial.printf("[main-node] HomeKit bridge -> mqtt://%s:%u as %s\n", mqttHost_,
                  config::kMqttPort, config::kMqttClientId);
  } else {
    Serial.println(
        "[main-node] HomeKit bridge off (not provisioned; hold side button at power-on)");
  }

#else
  mqttEnabled_ = false;
  hasWifi_ = false;
  hasMqttHost_ = false;
#endif

  if (environmentBusReady) initializeEnvironment(now);
  // Keep unavailable sensors on the same cadence as valid readings: this clears
  // retained MQTT state instead of leaving a stale environmental snapshot alive.
  lastEnvBroadcast_ = now;
  lastEnvPublication_ = now;
  lastNodeMqttHeartbeat_ = now;
  lastDiagnosticHeartbeat_ = now - config::kDiagnosticHeartbeatMs;
  return {};
}

MainRuntimeOutcome MainRuntime::tick(uint32_t now, const MainButtonEvents& buttons) {
  bool dirty = false;
  if (handleButtons(buttons, dirty)) return {true};

  handleRemoteForcePump(now, buttons, dirty);
  serviceDesktopControl(now);
  bool gotStatus = drainEspNowFrames(now, dirty);
  roster_.tick(now, config::kNodeOfflineTimeoutMs);

  view_.nodeCount = roster_.count();
  view_ = clampSelection(view_);
  if (gotStatus && view_.view == FleetView::Node) dirty = true;

  if (mqttEnabled_ && serviceMqtt(now)) return {true};
  MainRuntimeOutcome recovery = serviceConnectivityRecovery(now);
  if (recovery.restart) return recovery;
  updateSpotlightNode(now);

  if (envReady_ && now - lastRefresh_ >= config::kMainRefreshMs) {
    lastRefresh_ = now;
    reading_ = env_.read();
    metrics_ = computeEnvMetrics(reading_);
    if (view_.view == FleetView::Env) dirty = true;
    if (now - lastLog_ >= config::kEnvReadMs) {
      lastLog_ = now;
      logReading(reading_);
    }
  }

  if (isEnvironmentPublicationDue(now, lastEnvBroadcast_, config::kEnvBroadcastMs)) {
    lastEnvBroadcast_ = now;
    broadcastEnv(metrics_);  // Valid-only; never advertise a bad reading to sub-nodes.
  }
  if (mqttEnabled_ &&
      isEnvironmentPublicationDue(now, lastEnvPublication_, config::kEnvBroadcastMs)) {
    lastEnvPublication_ = now;
    publishEnvironment();  // Invalid metrics deliberately clear retained MQTT state.
  }

  if (hostTelemetry_) {
    EnvTimeSnapshot time = clock_.wireTime();
    bool validClock = time.hour != EnvTimeSnapshot::kInvalid &&
                      time.minute != EnvTimeSnapshot::kInvalid &&
                      time.month != EnvTimeSnapshot::kInvalid;
    hostTelemetry_->tick(
        now, metrics_, lastRefresh_, roster_, validClock,
        [this](const uint8_t* data, size_t size) { return transport_.sendHost(data, size); });
  }
  if (dirty) renderView();
  return {};
}

void MainRuntime::queueControlReply(const uint8_t reply[128], uint32_t now) {
  memcpy(controlReply_, reply, 128); controlReplyPending_ = true; controlReplyAt_ = now;
}

void MainRuntime::serviceDesktopControl(uint32_t now) {
  if (!desktopControl_) return;
  uint8_t input[128], reply[128];
  for (int budget = 0; budget < 3 && transport_.pollControl(input); ++budget) {
    const uint8_t node = input[54];
    if (input[4] >= 3 && input[4] != 6 && !roster_.findById(node)) continue;
    ControlAction action;
    if (desktopControl_->receive(input, sizeof(input), now, reply, action,
                                 forceRegistry_.isPhysical(node))) queueControlReply(reply, now);
    if (action.valid && action.type == ControlType::Plan) sendTimetable(action.node, action.plan);
  }
  desktopControl_->expire(now);
  const bool refresh = now - lastDesktopRefresh_ >= config::kRemoteForceRefreshMs;
  for (uint8_t node = 1; node <= 6; ++node) {
    bool on = desktopControl_->forced(node, now);
    auto changed = forceRegistry_.setDesktop(node, on);
    if (changed.valid) sendPumpCommand(node, changed.on);
    else if (on && refresh) sendPumpCommand(node, true);
  }
  if (refresh) lastDesktopRefresh_ = now;
  if (controlReplyPending_ && now - controlReplyAt_ >= 1000) controlReplyPending_ = false;
  if (controlReplyPending_ && transport_.sendHost(controlReply_, sizeof(controlReply_)))
    controlReplyPending_ = false;
}

void MainRuntime::logReading(const EnvReading& reading) const {
  if (!reading.valid) {
    Serial.println("[main-node] ENV read failed");
    return;
  }
  Serial.printf("[main-node] T=%.1fC H=%.1f%% P=%.1fhPa", reading.tempC, reading.humidity,
                reading.pressurePa / 100.0f);
  if (reading.luxValid) {
    Serial.printf(" L=%.0flx", reading.lux);
  } else {
    Serial.print(" L=--");
  }
  Serial.println();
}

void MainRuntime::broadcastEnv(const EnvMetrics& metrics) {
  if (!metrics.valid) return;
  EnvTimeSnapshot time = clock_.wireTime();
  float wireLux = metrics.luxValid ? metrics.lux : -1.0f;
  transport_.broadcast(makeEnvBroadcast(metrics.tempC, metrics.humidity, metrics.pressurePa,
                                        wireLux, metrics.vpdKpa, time.hour, time.minute,
                                        time.month));
}

uint8_t MainRuntime::mainChannel() const {
#ifdef HYDRA_DESKTOP_TELEMETRY
  return transport_.channel();
#else
  int channel = mqtt_.wifiChannel();
  return channel > 0 ? static_cast<uint8_t>(channel) : config::kDefaultEspNowChannel;
#endif
}

void MainRuntime::publishSubOtaProgress(const char* status) {
  MqttPayload payload{};
  mqttBridge_.buildSubOtaProgressPayload(status, payload);
  publishMqttPayloads(&payload, 1);
}

void MainRuntime::publishMqttPayloads(const MqttPayload* payloads, int count) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)payloads;
  (void)count;
  return;
#else
  if (!mqtt_.connected()) return;
  for (int i = 0; i < count; i++) mqtt_.publish(payloads[i].topic, payloads[i].value);
#endif
}

void MainRuntime::publishEnvironment() {
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  int count = mqttBridge_.buildEnvironmentSnapshot(metrics_, clock_.wireTime(), payloads);
  publishMqttPayloads(payloads, count);
}

void MainRuntime::publishSubNodeMqttState(uint32_t now) {
  if (!mqtt_.connected()) return;
  bool refresh = isNodeMqttHeartbeatDue(now, lastNodeMqttHeartbeat_, config::kNodeMqttHeartbeatMs);
  if (refresh) lastNodeMqttHeartbeat_ = now;
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  for (int i = 0; i < roster_.count(); i++) {
    const NodeStatus& node = roster_.at(i);
    int count = mqttBridge_.buildNodeSnapshot(node, payloads, refresh);
    publishMqttPayloads(payloads, count);
    // The outcome is its own retained topic and changes only when the sub-node consumes a
    // different entry, so it is published on change -- and also on the node heartbeat, like
    // every other node topic, so a broker that lost its retained store heals within a minute
    // instead of waiting hours for a different entry to be consumed.
    const bool outcomeDirty = mqttBridge_.outcomeChanged(node);
    if (refresh || outcomeDirty) {
      MqttPayload outcome{};
      if (mqttBridge_.buildTimetableOutcomePayload(node, outcome)) {
        publishMqttPayloads(&outcome, 1);
      }
    }
  }
}

void MainRuntime::publishDiagnostics(uint32_t now) {
  if (!mqtt_.connected() ||
      !isNodeMqttHeartbeatDue(now, lastDiagnosticHeartbeat_, config::kDiagnosticHeartbeatMs)) {
    return;
  }
  lastDiagnosticHeartbeat_ = now;
  MainDiagnosticSnapshot snapshot{
      diagnosticIdentity_.firmwareVersion,
      diagnosticIdentity_.buildIdentity,
      diagnosticIdentity_.bootIdentity,
      diagnosticIdentity_.resetReason,
      now,
      mqtt_.hasSuccessfulPublish(),
      mqtt_.lastSuccessfulPublishMs(),
  };
  MqttPayload payloads[MqttFleetBridge::kMaxDiagnosticPayloads];
  publishMqttPayloads(payloads, buildMainDiagnosticPayloads(snapshot, payloads));
}

MainRuntimeOutcome MainRuntime::serviceConnectivityRecovery(uint32_t now) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)now;
  return {};
#else
  if (!mqttEnabled_) return {};
  switch (linkRecovery_.tick(now, mqtt_.wifiConnected(), mqtt_.connected())) {
    case LinkRecoveryAction::NudgeWifi:
      mqtt_.nudgeWifi();
      break;
    case LinkRecoveryAction::RestartRadio:
      if (!restartRadioSafely()) return {true};
      break;
    case LinkRecoveryAction::RestartDevice:
      Serial.println("[mqtt] connectivity unavailable for 5 minutes -- restarting device");
      return {true};
    case LinkRecoveryAction::None:
    default:
      break;
  }
  return {};
#endif
}

bool MainRuntime::restartRadioSafely() {
#ifdef HYDRA_DESKTOP_TELEMETRY
  return false;
#else
  uint8_t recoveryChannel = mqtt_.recoveryChannel();
  transport_.end();
  mqtt_.restartRadio();
  delay(50);
  if (transport_.begin(recoveryChannel)) {
    Serial.printf("[mqtt] ESP-NOW restored on recovery channel %u\n", recoveryChannel);
    return true;
  }
  Serial.println("[mqtt] ESP-NOW re-init failed after radio restart");
  return false;
#endif
}

bool MainRuntime::serviceMqtt(uint32_t now) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)now;
  return false;
#else
  mqtt_.loop(now);
  int channel = mqtt_.wifiChannel();
  clock_.tick(channel != 0, channel, now);

  MqttLink::Incoming incoming;
  while (mqtt_.poll(incoming)) {
    MqttFleetBridge::Incoming command =
        mqttBridge_.classifyIncoming(incoming.topic, incoming.payload, now);
    if (command.kind == MqttFleetBridge::IncomingKind::MainOta) {
      uint32_t currentVersion = otaStore_.loadVersion();
      if (!shouldApplyOta(command.ota, currentVersion)) {
        Serial.printf("[ota] ignoring v=%u (current v=%u)\n", command.ota.version, currentVersion);
        continue;
      }
      Serial.printf("[ota] applying v=%u size=%u\n", command.ota.version, command.ota.binSize);
      if (!otaUpdater_.fetchAndFlash(command.ota.url, command.ota.binSize, command.ota.sha256)) {
        Serial.println("[ota] flash failed -- staying on the running image");
        continue;
      }
      otaStore_.saveVersion(command.ota.version);
      Serial.printf("[ota] v=%u flashed, restarting\n", command.ota.version);
      return true;
    }

    if (command.kind == MqttFleetBridge::IncomingKind::SubOta) {
      NasUrl nas{};
      if (!parseNasUrl(command.ota.url, nas)) {
        Serial.println("[sub-ota] bad NAS url (need http://ip:port/...)");
        publishSubOtaProgress("bad-url");
        continue;
      }
      Serial.printf(
          "[sub-ota] broadcasting OtaAnnounce v=%u size=%u seq=%u "
          "nas=%u.%u.%u.%u:%u\n",
          command.ota.version, command.ota.binSize, subOtaSeq_, nas.ip[0], nas.ip[1], nas.ip[2],
          nas.ip[3], nas.port);
      transport_.broadcast(makeOtaAnnounce(command.ota.version, command.ota.binSize,
                                           command.ota.sha256, nas.ip, nas.port, subOtaSeq_));
      subOtaSeq_++;
      otaStore_.saveNextSubOtaSeq(subOtaSeq_);
      publishSubOtaProgress("announced");
      continue;
    }

    if (command.kind == MqttFleetBridge::IncomingKind::Pump) {
      applyMqttForce(command.pump.nodeId, command.pump.on);
      Serial.printf("[main-node] HomeKit %s N%d\n", command.pump.on ? "force" : "release",
                    command.pump.nodeId);
    }

    if (command.kind == MqttFleetBridge::IncomingKind::Timetable) {
      sendTimetable(command.timetable.nodeId, command.timetable.table);
      publishTimetableAck(command.timetable.nodeId, command.timetable.table);
      // Name the author's night entries on the hub's own log too, so a night watering is
      // visible where the table was forwarded and not only on the sub-node's serial line.
      char nightList[24] = {};
      for (uint8_t e = 0; e < command.timetable.table.count; e++) {
        if (!command.timetable.table.entries[e].night) continue;
        const size_t used = strlen(nightList);
        snprintf(nightList + used, sizeof(nightList) - used, "%s%u", used ? "," : "", e);
      }
      Serial.printf("[main-node] timetable %u entries seq %u -> N%d%s%s\n",
                    static_cast<unsigned>(command.timetable.table.count), command.timetable.seq,
                    command.timetable.nodeId, nightList[0] ? " night=" : "", nightList);
    }

    if (command.kind == MqttFleetBridge::IncomingKind::TimetableReplay) {
      // A retained re-delivery or a QoS-1 copy of a Window already forwarded. The zone must
      // not re-arm a schedule from it, so it stops here: no ESP-NOW, and no acknowledgement
      // that would claim a forwarding that did not happen.
      Serial.printf("[main-node] timetable seq %u replayed, dropped\n", command.timetable.seq);
    }
  }

  for (MqttFleetBridge::Command command = mqttBridge_.tick(now); command.valid;
       command = mqttBridge_.tick(now)) {
    applyMqttForce(command.nodeId, command.on);
    if (!command.on) {
      Serial.printf("[main-node] HomeKit force on N%d auto-released\n", command.nodeId);
    }
  }

  publishSubNodeMqttState(now);
  publishDiagnostics(now);
  return false;
#endif
}

bool MainRuntime::runSetupPortal(char* host, size_t cap) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)host;
  (void)cap;
  return false;
#else
  Serial.printf("[main-node] setup portal: join \"%s\", open http://%s\n", config::kSetupApName,
                config::kSetupPortalUrl);
  display_.renderSetup(config::kSetupApName, config::kSetupPortalUrl);
  if (!wifiPortal_.run(config::kSetupApName, host, cap, config::kPortalTimeoutMs)) return false;
  if (sanitizeMqttHost(host)) provisioningStore_.saveHost(host);
  return true;
#endif
}

void MainRuntime::renderView() {
  switch (view_.view) {
    case FleetView::Menu:
      display_.renderMenu(view_.menuItem);
      break;
    case FleetView::Node:
      if (roster_.count() > 0) {
        const NodeStatus& selected = roster_.at(view_.selectedNode);
        display_.renderNode(selected, view_.selectedNode, roster_.count(),
                            forceRegistry_.isForced(selected.nodeId));
      } else {
        display_.renderNoNodes();
      }
      break;
    case FleetView::Config:
      display_.renderConfig(roster_, justPaired_);
      break;
    case FleetView::Env:
    default:
      display_.renderEnv(metrics_);
      break;
  }
}

bool MainRuntime::handleButtons(const MainButtonEvents& buttons, bool& dirty) {
  view_ = applyMainButtonEvents(view_, buttons);
  if (buttons.frontHeld) justPaired_ = 0;
  dirty = buttons.frontHeld || buttons.frontClicked || buttons.sideClicked;

  if (view_.view != FleetView::Setup) return false;
#ifdef HYDRA_DESKTOP_TELEMETRY
  view_.view = FleetView::Env;
  dirty = true;
  return false;
#else
  char host[40] = {};
  provisioningStore_.loadHost(host, sizeof(host));
  runSetupPortal(host, sizeof(host));
  return true;
#endif
}

void MainRuntime::handleRemoteForcePump(uint32_t now, const MainButtonEvents& buttons,
                                        bool& dirty) {
  bool canForce =
      view_.view == FleetView::Node && roster_.count() > 0 && roster_.at(view_.selectedNode).online;
  if (canForce && buttons.sideHeld) {
    physicalForceTarget_ = roster_.at(view_.selectedNode).nodeId;
    setPhysicalForce(physicalForceTarget_, true);
    lastForceMs_ = now;
    dirty = true;
  }
  if (physicalForceTarget_ != 0 && buttons.sideHolding &&
      now - lastForceMs_ >= config::kRemoteForceRefreshMs) {
    lastForceMs_ = now;
    sendPumpCommand(physicalForceTarget_, true);
  }
  if (physicalForceTarget_ != 0 && buttons.sideReleased) {
    setPhysicalForce(physicalForceTarget_, false);
    physicalForceTarget_ = 0;
    dirty = true;
  }
}

void MainRuntime::applyMqttForce(uint8_t targetId, bool on) {
  bool forcedBefore = forceRegistry_.isForced(targetId);
  RemoteForceCommand command = forceRegistry_.setMqtt(targetId, on);
  if (command.valid) {
    sendPumpCommand(command.targetId, command.on);
  } else if (on && forceRegistry_.isForced(targetId)) {
    // Preserve MqttFleetBridge's keep-alive contract even when physical force
    // already owns the same remote bit.
    sendPumpCommand(targetId, true);
  } else if (!on && !forcedBefore) {
    // MqttFleetBridge deliberately emits idempotent OFF for an unforced switch.
    sendPumpCommand(targetId, false);
  }
}

void MainRuntime::setPhysicalForce(uint8_t targetId, bool on) {
  RemoteForceCommand command = forceRegistry_.setPhysical(targetId, on);
  if (command.valid) {
    sendPumpCommand(command.targetId, command.on);
  } else if (on && forceRegistry_.isForced(targetId)) {
    sendPumpCommand(targetId, true);
  }
}

bool MainRuntime::drainEspNowFrames(uint32_t now, bool& dirty) {
  FleetMessage message;
  bool gotStatus = false;
  while (transport_.poll(message)) {
    if (message.type == static_cast<uint8_t>(FleetMsgType::PlanInstallReceipt)) {
      const NodeStatus* node = roster_.find(message.mac);
      Timetable table; uint8_t reply[128];
      if (desktopControl_ && node && node->nodeId == message.nodeId &&
          decodePlanInstallReceipt(message, node->nodeId, table) &&
          desktopControl_->observePlan(node->nodeId, table, message.pumpOn != 0, now,
                                      forceRegistry_.isPhysical(node->nodeId), reply))
        queueControlReply(reply, now);
      continue;
    }
    if (message.type == static_cast<uint8_t>(FleetMsgType::StatusReport)) {
      roster_.applyStatus(message, now);
      gotStatus = true;
      Serial.printf("[main-node] status from N%d: soil=%.0f%% %s\n", message.nodeId,
                    message.soilPercent, pumpStatusLabel(static_cast<PumpStatus>(message.status)));
      continue;
    }

    if (message.type != static_cast<uint8_t>(FleetMsgType::PairRequest)) continue;
    NodeStatus* known = roster_.find(message.mac);
    if (known) {
      broadcastPairAssign(message.mac, known->nodeId);
      sendPskDelivery(message.mac);
    } else if (view_.view == FleetView::Config) {
      uint8_t id = roster_.assign(message.mac, now);
      if (id == 0) continue;
      fleetStore_.save(roster_);
      justPaired_ = id;
      dirty = true;
      Serial.printf("[main-node] paired N%d (%02X:%02X)\n", id, message.mac[4], message.mac[5]);
      broadcastPairAssign(message.mac, id);
      sendPskDelivery(message.mac);
    }
  }
  return gotStatus;
}

void MainRuntime::updateSpotlightNode(uint32_t now) {
  uint8_t desired = view_.view == FleetView::Node && roster_.count() > 0
                        ? roster_.at(view_.selectedNode).nodeId
                        : 0;
  if (desired != viewedNode_) {
    if (viewedNode_ != 0) sendSpotlight(viewedNode_, false);
    if (desired != 0) sendSpotlight(desired, true);
    viewedNode_ = desired;
    lastSpotlightMs_ = now;
  } else if (viewedNode_ != 0 && now - lastSpotlightMs_ >= config::kSpotlightRefreshMs) {
    sendSpotlight(viewedNode_, true);
    lastSpotlightMs_ = now;
  }
}

void MainRuntime::initializeEnvironment(uint32_t now) {
  envReady_ = env_.begin();
  if (!envReady_) {
    Serial.println("[main-node] ERROR: CompositeEnvSensor init failed");
    return;
  }
  Serial.printf("[main-node] ENV III OK on channel %d, BH1750 OK on channel %d\n",
                config::kEnvChannel, config::kLightChannel);
  reading_ = env_.read();
  metrics_ = computeEnvMetrics(reading_);
  lastRefresh_ = now;
  lastLog_ = now;
  logReading(reading_);
  display_.renderEnv(metrics_);
}

void MainRuntime::sendPumpCommand(uint8_t targetId, bool on) {
  transport_.broadcast(makePumpCommand(targetId, on));
}

void MainRuntime::sendTimetable(uint8_t targetId, const Timetable& table) {
  transport_.broadcast(makeTimetableCommand(targetId, table));
}

void MainRuntime::publishTimetableAck(uint8_t nodeId, const Timetable& table) {
  MqttPayload payload{};
  buildTimetableAckPayload(nodeId, table, clock_.wireTime(), payload);
  publishMqttPayloads(&payload, 1);
}

void MainRuntime::sendSpotlight(uint8_t targetId, bool on) {
  transport_.broadcast(makeViewSpotlight(targetId, on));
}

void MainRuntime::broadcastPairAssign(const uint8_t mac[6], uint8_t id) {
  transport_.broadcast(makePairAssign(id, mac, mainChannel()));
}

void MainRuntime::sendPskDelivery(const uint8_t mac[6]) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)mac;
  return;
#else
  if (!mqttEnabled_) return;
  wifi_config_t config{};
  if (esp_wifi_get_config(WIFI_IF_STA, &config) != ESP_OK || config.sta.ssid[0] == 0) return;
  Serial.printf("[psk] delivering \"%s\" creds to %02X:%02X:%02X:%02X:%02X:%02X\n", config.sta.ssid,
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  transport_.broadcast(makePskDelivery(mac, reinterpret_cast<const char*>(config.sta.ssid),
                                       reinterpret_cast<const char*>(config.sta.password)));
#endif
}

}  // namespace hydra
