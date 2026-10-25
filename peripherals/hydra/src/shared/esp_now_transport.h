#pragma once
#include <cstddef>
#include <cstdint>

#include "domain/fleet_message.h"

namespace hydra {

// Forward-compatible recv gate. Pure so it is host-tested like the rest of the
// fleet logic. A frame is accepted when:
//   - len >= sizeof(FleetMessage): a larger frame (newer firmware emitting fields
//     this node does not know) is accepted -- only the first sizeof(FleetMessage)
//     bytes are copied, trailing bytes ignored. A shorter frame is rejected
//     (truncation/corruption).
//   - version >= kFleetProtocolVersion: a frame from an equal-or-newer schema is
//     accepted (this firmware parses the prefix it compiled against and ignores
//     trailing new fields). A frame from an older schema is rejected: fields this
//     firmware expects may be absent, and zero-filling them would guess at a value
//     nobody sent -- an appended field is only safe to skip if its zero means "not
//     reported", which is not something the gate can know.
// Together this lets a newer main node OTA-broadcast to an older sub-node so the
// sub can still receive an OtaAnnounce and self-upgrade over the air -- breaking
// the chicken-and-egg deadlock a wire-format change would otherwise cause. The
// cost is that a newer main does not see an older sub's StatusReport during the
// window (older->newer is rejected); the sub upgrades and reconnects.
inline bool shouldAcceptFrame(uint8_t version, int len) {
  return len >= static_cast<int>(sizeof(FleetMessage)) && version >= kFleetProtocolVersion;
}

// ESP-NOW broadcast transport shared by the main node (ESP32-PICO-D4) and the
// sub-nodes (ESP32-C6). Sends and receives FleetMessage frames over a fixed WiFi
// channel with no access point. Incoming frames are validated (length + protocol
// version) in the WiFi-task receive callback and queued in a small lock-free ring;
// the main loop drains it with poll(). One instance per node (state is a file-local
// singleton backing the C callbacks).
class EspNowTransport {
 public:
  // STA mode + pinned channel + ESP-NOW init + broadcast peer. Safe to call again
  // while this transport owns the driver: it just re-pins the requested channel.
  bool begin(uint8_t channel);

  // Deinitialize only the ESP-NOW driver owned by this transport. OTA callers use
  // this before WiFi.mode(WIFI_OFF), then call begin() to restore the callbacks
  // and broadcast peer after the radio comes back.
  void end();
  bool initialized() const;
  uint8_t channel() const;
  bool configureHost(const uint8_t gateway[6], const uint8_t pmk[16], const uint8_t lmk[16]);
  bool sendHost(const uint8_t* data, size_t size);
  bool pollControl(uint8_t out[128]);

  // Re-pin the radio to a new channel at runtime (sub-node channel sweep). Valid
  // only with no AP association -- the main node, once joined to Wi-Fi, is locked
  // to the router's channel and this is a no-op there.
  void setChannel(uint8_t channel);

  // Broadcast one frame to FF:FF:FF:FF:FF:FF. Returns false if the send was rejected.
  bool broadcast(const FleetMessage& msg);

  // Pop the next received frame if any; false when the queue is empty.
  bool poll(FleetMessage& out);

  // This node's STA MAC (valid after begin()).
  void macAddress(uint8_t out[6]) const;
};

}  // namespace hydra
