#pragma once
#include <cstdint>

#include "shared/config.h"

// Main-node (M5StickC Plus sensor hub) tuning: the Grove I2C bus + PaHub/ENV/BH1750,
// light thresholds, ESP-NOW broadcast/keep-alive cadences this node originates, and
// the HomeKit/MQTT bridge. Shared wire constants live in shared/config.h.

namespace hydra {
namespace config {

// --- Grove I2C bus + PaHub/ENV/BH1750 ---
// M5StickC Plus Grove: G32 (yellow/SDA), G33 (white/SCL).
// PaHub DIP set to 0x71 to avoid the QMP6988 0x70 collision.
// ENV III on PaHub channel 0, BH1750 (DLight Unit) on PaHub channel 5.
constexpr int kI2cSda = 32;
constexpr int kI2cScl = 33;
constexpr uint32_t kI2cFreq = 400000U;
constexpr uint8_t kPaHubAddr = 0x71;
constexpr uint8_t kEnvChannel = 0;
constexpr uint8_t kLightChannel = 5;

// Caladium light: bright indirect, 1000-10000 lux ideal.
constexpr float kLuxLowThreshold = 500.0f;     // below this: insufficient light
constexpr float kLuxHighThreshold = 30000.0f;  // above this: direct sun risk

// --- Fleet link cadences this node originates ---
constexpr uint32_t kEnvBroadcastMs = 60000U;        // main -> all env cadence (1/min)
constexpr uint32_t kNodeOfflineTimeoutMs = 8000U;  // mark a sub-node offline after this

// Remote force-watering keep-alive (side button held / HomeKit switch): the main
// re-sends "pump on" this often; the sub-node's own watchdog stops the pump if it
// stops hearing it (see kRemoteForceTimeoutMs in app/sub_runtime_config.h).
constexpr uint32_t kRemoteForceRefreshMs = 250U;

// "Viewing" spotlight re-send cadence: while the fleet page shows a sub-node, the
// main re-lights its blue LED this often (the sub clears it on its own timeout).
constexpr uint32_t kSpotlightRefreshMs = 1000U;

// --- HomeKit bridge (MQTT -> Homebridge mqttthing, main node only) ---
// Provisioned at runtime through a SoftAP captive portal (hold the side button
// at power-on to re-provision): Wi-Fi credentials persist in the radio's NVS,
// the broker address in the hydra-net namespace. Unprovisioned, the node runs
// dashboard-only. Once the STA associates, the radio follows the router's channel
// and esp_wifi_set_channel is blocked -- so the fleet adopts that channel: the
// main node reports it in pairing replies and sub-nodes follow (no router channel
// pinning needed). See docs/homekit-mqtt.md.
constexpr const char* kSetupApName = "Hydra-Setup";
constexpr const char* kSetupPortalUrl = "192.168.4.1";
constexpr uint32_t kPortalTimeoutMs = 300000U;  // give up after 5 min, run offline
constexpr uint16_t kMqttPort = 1883;
constexpr const char* kMqttClientId = "hydra-main";
#ifndef HYDRA_FIRMWARE_VERSION
#define HYDRA_FIRMWARE_VERSION "121"
#endif
#ifndef HYDRA_BUILD_IDENTITY
#define HYDRA_BUILD_IDENTITY "main-node-v121-" __DATE__ "T" __TIME__
#endif
constexpr const char* kFirmwareVersion = HYDRA_FIRMWARE_VERSION;
constexpr const char* kBuildIdentity = HYDRA_BUILD_IDENTITY;
// LWT availability topic. The broker sets this to "false" (retained) if the main
// node drops ungracefully; the node publishes "true" on connect and as a heartbeat
// so a connected-but-hung node is also detectable. Consumed by the iOS app to tell
// a live main node apart from a frozen retained ghost.
constexpr const char* kMainOnlineTopic = "hydra/main/online";
constexpr uint32_t kMqttReconnectMs = 5000U;  // broker (re)connect attempt cadence
constexpr uint32_t kNodeMqttHeartbeatMs = 60000U;  // refresh retained node snapshots
constexpr uint32_t kDiagnosticHeartbeatMs = 60000U;

// Wi-Fi/MQTT recovery is bounded: one reconnect nudge, one radio cycle coordinated
// with ESP-NOW teardown/reinitialization, then a full device restart by five minutes.
constexpr uint32_t kWifiNudgeMs = 30000U;
constexpr uint32_t kWifiRestartMs = 60000U;
constexpr uint32_t kConnectivityRestartMs = 300000U;

// Safety cap on a HomeKit force-watering switch: auto-release after this long so
// a switch left ON in the Home app can never run a pump indefinitely. Keep-alive
// re-send reuses kRemoteForceRefreshMs (same sub-node watchdog as BtnB).
constexpr uint32_t kMqttForceMaxMs = 60000U;

// --- Loop cadence ---
// Sensor hub refreshes fast so ambient light tracks changes in ~1 s (the BH1750
// settles in ~120 ms; the 30 s ENV cadence felt frozen on screen).
constexpr uint32_t kMainRefreshMs = 1000U;

// OTA health gate is shared: see config::kOtaHealthMs in shared/config.h.

}  // namespace config
}  // namespace hydra
