#pragma once
#include <cstdint>

namespace hydra {

// Wi-Fi STA + MQTT (PubSubClient) glue for the main node's HomeKit bridge. Joins
// the home network, keeps the broker connection alive, publishes retained topics
// and queues incoming hydra/+/pump/set commands for the main loop to poll --
// mirroring EspNowTransport's poll style. Once the STA associates, the radio is
// locked to the router's channel; the fleet adopts that channel (reported to
// sub-nodes in pairing replies), so no router channel pinning is needed.
//
// All connecting is non-blocking and retried from loop(), so a missing router or
// broker never stalls watering or the dashboard. One instance per node (state is
// a file-local singleton backing the PubSubClient callback).
class MqttLink {
 public:
  struct Incoming {
    char topic[32];
    // Holds the maximum parseOtaCommand record: two u32 fields, 64 hex SHA
    // characters, a 127-byte URL, separators, and the terminating NUL.
    char payload[256];
  };

  // Starts the Wi-Fi association (non-blocking) using the credentials the setup
  // portal persisted in the radio's NVS. host is copied (it comes from a stack
  // buffer); clientId must be a string literal.
  void begin(const char* host, uint16_t port, const char* clientId, uint32_t reconnectMs);

  // Drives the Wi-Fi/MQTT state machine; call every loop pass.
  void loop(uint32_t now);

  bool wifiConnected() const;
  bool connected();
  bool hasSuccessfulPublish() const;
  uint32_t lastSuccessfulPublishMs() const;

  // Bounded recovery primitives. MainRuntime owns the escalation policy and
  // coordinates ESP-NOW teardown/reinitialization around restartRadio().
  void nudgeWifi();
  void restartRadio();

  // Publish a retained topic. False when disconnected or rejected.
  bool publish(const char* topic, const char* value);

  // Pop the next received set command if any; false when the queue is empty.
  bool poll(Incoming& out);

  // The channel the STA actually associated on (0 before connect). The main node
  // reports it to sub-nodes in pairing replies so the fleet follows the router.
  int wifiChannel() const;
  uint8_t recoveryChannel() const;
};

}  // namespace hydra
