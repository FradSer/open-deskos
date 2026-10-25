#pragma once
#include <cstdint>

// Wire/protocol and shared-transfer constants referenced by both node types.
// Node-local tuning lives next to its consuming main-node or sub-node behavior.
// Everything stays in namespace hydra::config so call sites keep using config::kXxx.

namespace hydra {
namespace config {

// Print an I2C scan at boot and per-tick readings to Serial @115200, for
// bring-up. Set false once the wiring is confirmed.
constexpr bool kSerialDebug = true;

// ESP-NOW bootstrap channel. The main node, once it joins Wi-Fi, is locked to the
// router's channel (esp_wifi_set_channel is blocked while associated), so the fleet
// channel is whatever the router picked. The main node reports it in every pairing
// reply; sub-nodes sweep until they hear the main node, then lock on and persist it.
// This is only the bootstrap value: where an unprovisioned main node sits and where
// a sub-node starts before it has paired. No router channel pinning required.
constexpr uint8_t kDefaultEspNowChannel = 1;

// Controller env cadence (slow-changing). Drives the sub-node's policy env refresh
// and the main node's periodic env serial log.
constexpr uint32_t kEnvReadMs = 30000U;

// OTA health gate: a freshly-flashed image boots "pending verify"; both nodes
// run cleanly past this window before esp_ota_mark_app_valid_cancel_rollback(),
// so a crash-looping new image rolls back instead of getting pinned. Shared
// because both chips run the same ESP-IDF bootloader contract.
constexpr uint32_t kOtaHealthMs = 15000U;

// Shared LAN OTA transfer stall guard. Both nodes abort an HTTP stream that
// stops making progress instead of waiting forever on a half-closed socket.
constexpr uint32_t kOtaStallMs = 15000U;

}  // namespace config
}  // namespace hydra
