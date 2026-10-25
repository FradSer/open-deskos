#include "sub_node/app/sub_runtime.h"

#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <M5NanoC6.h>
#include <WiFi.h>
#include <cstring>

#include "domain/fleet_codec.h"
#include "domain/pump_status.h"
#include "sub_node/hal/node_identity.h"
#include "shared/ota_transfer.h"
#include "shared/ota_writer.h"
#include "sub_node/hal/ota_store.h"
#include "sub_node/hal/wifi_creds.h"
#include "sub_node/hal/wire_clock.h"
#include "shared/esp_now_transport.h"

namespace hydra {

namespace {

constexpr ChannelScanConfig kChannelScanConfig{config::kChannelSilenceTimeoutMs,
                                               config::kChannelScanDwellMs};
constexpr PairingFeedbackConfig kPairingFeedbackConfig{
    config::kPairTimeoutMs, 2000U, 125U, config::kSpotlightTimeoutMs};

}  // namespace

SubRuntime::SubRuntime(IWateringZone** zones, int zoneCount, WireClock& clock,
                       EspNowTransport& transport, OtaWriter& otaWriter,
                       Adafruit_NeoPixel& strip)
    : clock_(clock),
      transport_(transport),
      otaWriter_(otaWriter),
      strip_(strip),
      controller_(zones, zoneCount, config::kSeasonal, clock),
      pairingFeedback_(kPairingFeedbackConfig) {}

uint8_t SubRuntime::bootChannel() const {
  return NodeIdentity::loadChannel(config::kDefaultEspNowChannel);
}

void SubRuntime::begin(uint8_t bootChannel, const uint8_t mac[6], bool radioReady,
                       uint32_t now) {
  memcpy(mac_, mac, sizeof(mac_));
  if (radioReady) nodeId_ = NodeIdentity::load();
  scan_.channel = bootChannel;
  scan_.lastHeardMs = now;
  firmwareVersion_ = OtaStore::loadVersion();
  controller_.begin();
}

SubRuntimeOutcome SubRuntime::tick(uint32_t now, const SubButtonEvents& buttons) {
  handleButtonEvents(now, buttons);

  // Consume queued EnvBroadcasts before applying the stale watchdog: a frame
  // that arrived at the deadline is fresh, not an outage that should abort a
  // noncritical cycle.
  FleetMessage frame;
  while (!otaMode_ && transport_.poll(frame)) {
    SubRuntimeOutcome outcome = handleFrame(frame, now);
    if (outcome.restart) return outcome;
  }

  if (remoteForce_ &&
      isRemoteForceStale(now, remoteForceAt_, config::kRemoteForceTimeoutMs)) {
    remoteForce_ = false;
    controller_.setRemoteForceWatering(0, false, now);
  }

  handlePeriodicTick(now);
  if (!otaMode_) serviceChannelScan(now);
  updateBlueLed(now);

  if (nodeId_ != 0 && now - lastStatus_ >= config::kStatusBroadcastMs) {
    lastStatus_ = now;
    broadcastStatus();
  }

  if (now - lastDraw_ >= 500U) {
    lastDraw_ = now;
    updateRgbLed(controller_.snapshot(0).soil);
  }
  return {};
}

bool SubRuntime::isMainFrame(uint8_t type) const {
  return type == static_cast<uint8_t>(FleetMsgType::EnvBroadcast) ||
         type == static_cast<uint8_t>(FleetMsgType::PairAssign) ||
         type == static_cast<uint8_t>(FleetMsgType::PumpCommand) ||
         type == static_cast<uint8_t>(FleetMsgType::Timetable) ||
         type == static_cast<uint8_t>(FleetMsgType::ViewSpotlight) ||
         type == static_cast<uint8_t>(FleetMsgType::OtaAnnounce) ||
         type == static_cast<uint8_t>(FleetMsgType::PskDelivery);
}

void SubRuntime::enterPairing(uint32_t now) {
  pairingFeedback_.startManualPairing(now);
  lastPairRequest_ = 0;
  if (config::kSerialDebug) Serial.println("[hydra] pairing: requesting an id...");
}

void SubRuntime::broadcastPairRequest() {
  transport_.broadcast(makePairRequest(nodeId_, mac_));
}

void SubRuntime::broadcastStatus() {
  IrrigationController::StatusSnapshot status = controller_.snapshot(0);
  const SoilReading& soil = status.soil;
  transport_.broadcast(makeStatusReport(
      nodeId_, mac_, soil.raw, soil.percent, soil.valid, static_cast<uint8_t>(status.pumpStatus),
      status.pulseCount, static_cast<uint8_t>(status.effectiveDryPercent + 0.5f),
      static_cast<uint8_t>(status.season), firmwareVersion_,
      TimetableOutcome{status.ttOutcomeWindowSeq, status.ttOutcomeIndex, status.ttOutcomeCode,
                       status.ttRanCount, status.ttRefusedCount}));
}

void SubRuntime::updateRgbLed(const SoilReading& soil) {
  if (!soil.valid) {
    strip_.setPixelColor(0, strip_.Color(64, 64, 64));
  } else if (soil.percent < 30.0f) {
    strip_.setPixelColor(0, strip_.Color(255, 0, 0));
  } else if (soil.percent < 60.0f) {
    uint8_t green = static_cast<uint8_t>((soil.percent - 30.0f) / 30.0f * 255);
    strip_.setPixelColor(0, strip_.Color(255, green, 0));
  } else {
    uint8_t red = static_cast<uint8_t>((1.0f - (soil.percent - 60.0f) / 40.0f) * 255);
    strip_.setPixelColor(0, strip_.Color(red, 255, 0));
  }
  strip_.show();
}

SubRuntimeOutcome SubRuntime::runOta(uint32_t now) {
  otaMode_ = true;
  controller_.setAutomationPaused(true, now);
  setBlueLed(true);
  bool radioTornDown = false;
  bool transferSucceeded = false;

  bool hasWiFiCredentials = WifiCreds::hasCredentials();
  if (!hasWiFiCredentials) {
    Serial.println("[ota] no Wi-Fi creds (never paired with PSK) -- aborting");
    otaMode_ = false;
    controller_.setAutomationPaused(false, millis());
    setBlueLed(false);
    return {};
  }

  if (shouldReleaseEspNowBeforeOta(hasWiFiCredentials)) transport_.end();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  radioTornDown = true;
  delay(50);
  if (!WifiCreds::connect(15000)) {
    Serial.println("[ota] Wi-Fi connect failed -- aborting");
    goto disconnect_wifi;
  }

  char url[48];
  snprintf(url, sizeof(url), "http://%u.%u.%u.%u:%u/sub.bin", pendingOtaIp_[0],
           pendingOtaIp_[1], pendingOtaIp_[2], pendingOtaIp_[3], pendingOtaPort_);
  transferSucceeded = transferOtaHttp(url, pendingOtaSize_, pendingOtaSha_, otaWriter_);
  if (transferSucceeded) {
    OtaStore::saveVersion(pendingOtaVersion_);
    firmwareVersion_ = pendingOtaVersion_;
    if (shouldTearDownWiFiBeforeOtaRestart(radioTornDown, transferSucceeded)) {
      WiFi.disconnect(true);
      WiFi.mode(WIFI_OFF);
    }
    Serial.println("[ota] flash verified, restarting");
    return {true};
  }
  Serial.println("[ota] transfer failed -- keeping running image");

disconnect_wifi:
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(50);
restore_radio:
  if (shouldReinitializeRadioAfterOta(radioTornDown, /*transferSucceeded=*/false) &&
      !transport_.begin(scan_.channel)) {
    Serial.println("[ota] ESP-NOW re-init failed after OTA -- restarting");
    return {true};
  }
  otaMode_ = false;
  controller_.setAutomationPaused(false, millis());
  setBlueLed(false);
  Serial.println("[ota] exited OTA mode, resuming normal operation");
  return {};
}

void SubRuntime::handleButtonEvents(uint32_t now, const SubButtonEvents& buttons) {
  if (!bootReconfigureStarted_ &&
      observeBootButton(bootButton_, buttons.pressed, now, config::kButtonHoldMs)) {
    bootReconfigureStarted_ = true;
    enterPairing(now);
    return;
  }
  if (buttons.singleClicked) {
    if (pairingFeedback_.pairingActive(now)) {
      pairingFeedback_.cancelPairing();
    } else if (controller_.snapshot(0).fault) {
      controller_.clearFault(0);
    }
  }
  if (buttons.hold && !pairingFeedback_.pairingActive(now) && nodeId_ != 0) {
    manualForce_ = true;
    controller_.setLocalForceWatering(0, true, now);
  }
  if (buttons.released && manualForce_) {
    manualForce_ = false;
    controller_.setLocalForceWatering(0, false, now);
  }
}

void SubRuntime::handlePeriodicTick(uint32_t now) {
  if (now - lastTick_ < config::kTickMs) return;
  lastTick_ = now;
  if (isEnvironmentStale(now, lastEnvAt_, config::kEnvStaleMs)) {
    remoteEnv_.valid = false;
    clock_.invalidate();
  }

  clock_.tick(now);
  controller_.setEnvContext(remoteEnv_);
  controller_.tick(now);

  if (config::kSerialDebug) {
    // The entry that just started a cycle, once per entry. `night` is printed, never
    // consulted: a night entry still waters, and the line is what makes that visible.
    IrrigationController::TimetableEntryNotice entry;
    if (controller_.consumeTimetableEntry(entry)) {
      Serial.printf("[hydra] timetable entry window=%lu idx=%u offset=%u intent=%s night=%d\n",
                    static_cast<unsigned long>(entry.windowSeq), entry.index,
                    entry.offsetMinutes, planName(entry.intent), entry.night ? 1 : 0);
    }
    if (controller_.consumeCriticalOverride()) {
      Serial.printf("[hydra] critical-dry override: soil=%.0f%% hour=%d\n",
                    controller_.snapshot(0).soil.percent, clock_.currentHour());
    }
  }

  if (!config::kSerialDebug) return;
  IrrigationController::StatusSnapshot status = controller_.snapshot(0);
  const SoilReading& soil = status.soil;
  const char* link = nodeId_ == 0 ? "unpaired" : (scan_.scanning ? "SCAN" : "ok");
  const char* pump = pumpStatusLabel(status.pumpStatus);
  if (soil.valid) {
    Serial.printf("[hydra] N%d ch%d %s | %s %s %s | z0 raw=%d pct=%.0f | dry=%.1f%%/h eff=%.0f%%",
                  nodeId_, scan_.channel, link, status.paused ? "PAUSE" : "AUTO",
                  seasonName(status.season), pump, soil.raw, soil.percent, status.dryingRate,
                  status.effectiveDryPercent);
    if (remoteEnv_.valid) {
      Serial.printf(" VPD=%.2fkPa lux=%.0f", remoteEnv_.vpdKpa, remoteEnv_.lux);
    } else {
      Serial.print(" env:stale");
    }
    Serial.printf(" | %02d:xx\n", clock_.currentHour());
  } else {
    Serial.printf("[hydra] N%d ch%d %s | %s %s %s | z0 raw=%d NC | %02d:xx\n", nodeId_,
                  scan_.channel, link, status.paused ? "PAUSE" : "AUTO",
                  seasonName(status.season), pump, soil.raw, clock_.currentHour());
  }
}

SubRuntimeOutcome SubRuntime::handleFrame(const FleetMessage& frame, uint32_t now) {
  if (isMainFrame(frame.type)) scan_ = onMainHeard(scan_, now);

  if (frame.type == static_cast<uint8_t>(FleetMsgType::EnvBroadcast)) {
    remoteEnv_ = {frame.vpdKpa, frame.lux, true};
    lastEnvAt_ = now;
    clock_.update(frame.hour, frame.minute, frame.month, now);
  }

  if (frame.type == static_cast<uint8_t>(FleetMsgType::PairAssign) &&
      memcmp(frame.mac, mac_, sizeof(mac_)) == 0) {
    nodeId_ = frame.nodeId;
    NodeIdentity::save(nodeId_);
    uint8_t channel = frame.channel != 0 ? frame.channel : scan_.channel;
    if (channel != scan_.channel) {
      scan_.channel = channel;
      transport_.setChannel(channel);
    }
    NodeIdentity::saveChannel(scan_.channel);
    bool manualPairing = pairingFeedback_.pairingActive(now);
    if (manualPairing) pairingFeedback_.confirmManualPairing(now);
    if (config::kSerialDebug) {
      Serial.printf("[hydra] paired as N%d on ch %d%s\n", nodeId_, scan_.channel,
                    manualPairing ? " (manual)" : " (recovery)");
    }
  } else if (frame.type == static_cast<uint8_t>(FleetMsgType::PumpCommand) &&
             nodeId_ != 0 && frame.nodeId == nodeId_) {
    controller_.setRemoteForceWatering(0, frame.pumpOn != 0, now);
    remoteForce_ = frame.pumpOn != 0;
    if (remoteForce_) remoteForceAt_ = now;
  } else if (frame.type == static_cast<uint8_t>(FleetMsgType::Timetable)) {
    // One line of glue: addressing and every structural rule live in the codec and the
    // executor, so a frame that decodes is a Window this zone can execute (ADR-0006).
    Timetable table;
    if (decodeTimetable(frame, nodeId_, table)) {
      bool installed = planInstallReceipt_.install(table, [&](const Timetable& value) {
        return controller_.installTimetable(0, value, now);
      });
      transport_.broadcast(makePlanInstallReceipt(nodeId_, mac_, table, installed));
    }
  } else if (frame.type == static_cast<uint8_t>(FleetMsgType::ViewSpotlight) &&
             nodeId_ != 0 && frame.nodeId == nodeId_) {
    pairingFeedback_.setSpotlight(frame.viewOn != 0, now);
  } else if (frame.type == static_cast<uint8_t>(FleetMsgType::OtaAnnounce) && !otaMode_) {
    uint32_t currentVersion = OtaStore::loadVersion();
    uint32_t lastSeq = OtaSeqStore::loadSeq();
    if (frame.otaVersion > currentVersion && frame.otaSeq > lastSeq) {
      OtaSeqStore::saveSeq(frame.otaSeq);
      pendingOtaVersion_ = frame.otaVersion;
      pendingOtaSize_ = frame.otaBinSize;
      memcpy(pendingOtaSha_, frame.otaSha256, sizeof(pendingOtaSha_));
      memcpy(pendingOtaIp_, frame.otaIp, sizeof(pendingOtaIp_));
      pendingOtaPort_ = frame.otaPort;
      return runOta(now);
    }
  } else if (frame.type == static_cast<uint8_t>(FleetMsgType::PskDelivery) &&
             memcmp(frame.mac, mac_, sizeof(mac_)) == 0) {
    WifiCreds::save(frame.ssid, frame.psk);
  }
  return {};
}

void SubRuntime::updateBlueLed(uint32_t now) {
  setBlueLed(pairingFeedback_.ledOn(now));
}

void SubRuntime::serviceChannelScan(uint32_t now) {
  uint8_t previous = scan_.channel;
  scan_ = serviceScan(scan_, kChannelScanConfig, nodeId_ != 0,
                      pairingFeedback_.pairingActive(now), now);
  if (scan_.channel != previous) {
    transport_.setChannel(scan_.channel);
    lastPairRequest_ = 0;
  }
  if (scan_.scanning && now - lastPairRequest_ >= config::kPairRequestMs) {
    lastPairRequest_ = now;
    broadcastPairRequest();
  }
}

void SubRuntime::setBlueLed(bool on) {
  digitalWrite(M5NANO_C6_BLUE_LED_PIN, on ? HIGH : LOW);
}

}  // namespace hydra
