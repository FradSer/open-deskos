#pragma once
#include "domain/host_telemetry.h"
#include "main_node/app/fleet_roster.h"
namespace hydra {
// A bounded periodic batch repairs packet loss without replaying commands.
class HostTelemetryPublisher {
 public:
  HostTelemetryPublisher(const char* boot, const char* firmware) : session_(boot, firmware) {}
  template <class Sender>
  void tick(uint32_t now, const EnvMetrics& env, uint32_t sampleAt, const FleetRoster& roster,
            bool clock, Sender send) {
    if (!started_ || now - batchAt_ >= 2000) {
      started_ = true;
      batchAt_ = now;
      cursor_ = 0;
      active_ = true;
    }
    if (!active_ || (sent_ && now - sentAt_ < 25)) return;
    char bytes[251];
    bool valid = false;
    if (cursor_ == 0)
      valid = session_.hello(bytes, sizeof(bytes), now, clock);
    else if (cursor_ == 1)
      valid = session_.environment(bytes, sizeof(bytes), env, now - sampleAt);
    else if (cursor_ - 2 < roster.count())
      valid = session_.node(bytes, sizeof(bytes), roster.at(cursor_ - 2), now);
    else {
      active_ = false;
      return;
    }
    // Drop a busy frame. The next periodic batch samples current values again.
    if (valid) send(reinterpret_cast<const uint8_t*>(bytes), strlen(bytes));
    ++cursor_;
    sent_ = true;
    sentAt_ = now;
  }

 private:
  HostTelemetrySession session_;
  uint32_t batchAt_ = 0, sentAt_ = 0;
  int cursor_ = 0;
  bool active_ = false, started_ = false, sent_ = false;
};
}  // namespace hydra
