#pragma once

#include <cstdint>

#include "domain/i_clock.h"

namespace hydra {

// Clock cached from main-node EnvBroadcasts. It advances between fresh frames,
// but the runtime invalidates it when the same env-staleness watchdog expires.
// Until another valid broadcast arrives, routine watering treats time as night;
// only the controller's critical-dry override can proceed.
class WireClock : public IClock {
 public:
  static constexpr uint8_t kInvalid = 0xFF;

  // A valid broadcast restores the clock after a stale invalidation. The 0xFF
  // pre-SNTP marker is ignored, leaving an existing valid time unchanged until
  // the runtime watchdog deliberately invalidates it.
  void update(uint8_t hour, uint8_t minute, uint8_t month, uint32_t now) {
    if (hour == kInvalid || minute == kInvalid || month == kInvalid) return;
    baseHour_ = hour;
    baseMinute_ = minute;
    baseMonth_ = month;
    syncMillis_ = now;
    currentHour_ = hour;
    currentMinute_ = minute;
    valid_ = true;
  }

  // Runtime calls this idempotently with the EnvBroadcast stale watchdog.
  void invalidate() { valid_ = false; }

  void tick(uint32_t now) {
    if (!valid_ || syncMillis_ == 0) return;
    uint32_t elapsed = now - syncMillis_;
    uint32_t totalMinutes = baseMinute_ + elapsed / 60000;
    currentHour_ = (baseHour_ + totalMinutes / 60) % 24;
    currentMinute_ = totalMinutes % 60;
  }

  int currentHour() const override { return valid_ ? static_cast<int>(currentHour_) : -1; }
  int currentMinute() const { return valid_ ? static_cast<int>(currentMinute_) : -1; }
  int currentMonth() const override { return valid_ ? static_cast<int>(baseMonth_) : -1; }
  bool isValid() const override { return valid_; }

 private:
  uint8_t baseHour_ = 0;
  uint8_t baseMinute_ = 0;
  uint8_t baseMonth_ = 0;
  uint8_t currentHour_ = 0;
  uint8_t currentMinute_ = 0;
  uint32_t syncMillis_ = 0;
  bool valid_ = false;
};

}  // namespace hydra
