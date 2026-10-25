#pragma once

namespace hydra {

// Wall-clock abstraction for time-of-day gating and seasonal awareness. The
// domain layer depends on this, not on RTC or NTP specifics. currentHour()
// returns 0-23 when valid, or -1 when the clock has no valid time.
// currentMonth() returns 1-12 when valid, or -1 when invalid.
class IClock {
 public:
  virtual ~IClock() = default;
  virtual int currentHour() const = 0;
  virtual int currentMonth() const = 0;
  virtual bool isValid() const = 0;
};

}  // namespace hydra
