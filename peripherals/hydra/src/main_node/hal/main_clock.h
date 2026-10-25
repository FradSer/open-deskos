#pragma once

#include <cstdint>
#include <ctime>

namespace hydra {

constexpr std::time_t kMainClockSyncedEpochFloor = 1704067200;  // 2024-01-01 UTC

// The exact time slice carried in EnvBroadcast. 0xFF marks every field invalid
// until the BM8563 holds a trusted calendar time.
struct EnvTimeSnapshot {
  static constexpr uint8_t kInvalid = 0xFF;

  uint8_t hour;
  uint8_t minute;
  uint8_t month;
};

inline bool isSystemClockSynchronized(std::time_t epoch) {
  return epoch >= kMainClockSyncedEpochFloor;
}

inline bool shouldStartSntp(bool wifiConnected, bool sntpStarted) {
  return wifiConnected && !sntpStarted;
}

inline bool shouldPushRtc(bool systemClockSynchronized, bool rtcPushed) {
  return systemClockSynchronized && !rtcPushed;
}

constexpr uint32_t kSntpRetryMs = 60000U;  // re-arm SNTP until a sync lands

// SNTP is started once and then never retried, so a network where the servers never
// answer leaves the fleet with no disciplined time source at all: the RTC is never
// pushed from a sync and free-runs as the only clock. Re-arm the sync until one
// lands. Unsigned subtraction handles the millis() wrap.
inline bool shouldRetrySntp(bool wifiConnected, bool sntpSynced, uint32_t now,
                            uint32_t lastAttemptAt, uint32_t retryMs) {
  if (!wifiConnected || sntpSynced) return false;
  return now - lastAttemptAt >= retryMs;
}

inline bool isValidRtcTime(int year, int hour, int minute, int month) {
  return year >= 2024 && hour >= 0 && hour < 24 && minute >= 0 && minute < 60 &&
         month >= 1 && month <= 12;
}

inline EnvTimeSnapshot makeEnvTimeSnapshot(int year, int hour, int minute, int month) {
  if (!isValidRtcTime(year, hour, minute, month)) {
    return {EnvTimeSnapshot::kInvalid, EnvTimeSnapshot::kInvalid, EnvTimeSnapshot::kInvalid};
  }
  return {static_cast<uint8_t>(hour), static_cast<uint8_t>(minute),
          static_cast<uint8_t>(month)};
}

// Which time the fleet is told. The RTC is written once per boot and then free-runs
// with no correction path, so it carries whatever error it has accumulated — it was
// measured about 11 minutes behind local after 5.6 days of uptime on 2026-09-22,
// which skews the 06:00-21:00 watering window every sub-node gates on. A system clock
// SNTP has disciplined therefore wins wherever one exists; the RTC is the fallback for
// the window before the first sync and for a network where NTP never answers.
inline EnvTimeSnapshot selectWireTime(bool systemSynced, const EnvTimeSnapshot& system,
                                      const EnvTimeSnapshot& rtc) {
  return systemSynced ? system : rtc;
}

// Hardware time lifecycle for the main node: start SNTP once Wi-Fi is available,
// write the synchronized system clock into the BM8563 once, expose its validated
// wire-time snapshot, and report router-channel changes.
class MainClock {
 public:
  void tick(bool wifiConnected, int wifiChannel, uint32_t now);
  EnvTimeSnapshot wireTime() const;

 private:
  bool sntpStarted_ = false;
  bool sntpSynced_ = false;
  bool rtcPushed_ = false;
  int lastChannel_ = 0;
  uint32_t lastSntpAttemptAt_ = 0;
};

}  // namespace hydra
