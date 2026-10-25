#include "main_node/hal/main_clock.h"

#include <Arduino.h>
#include <M5Unified.h>
#include <time.h>

namespace hydra {

namespace {

void startSntp() {
#ifdef HYDRA_DESKTOP_TELEMETRY
  return;
#else
  // These servers are reachable from the deployment network; sync runs in the
  // background and the BM8563 is updated only after the system clock is valid.
  configTzTime("CST-8", "ntp.aliyun.com", "ntp.tencent.com", "pool.ntp.org");
  Serial.println("[clock] SNTP sync started (CST-8)");
#endif
}

}  // namespace

void MainClock::tick(bool wifiConnected, int wifiChannel, uint32_t now) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  (void)wifiConnected;
  (void)wifiChannel;
  (void)now;
  return;
#else
  bool start = shouldStartSntp(wifiConnected, sntpStarted_);
  bool retry = sntpStarted_ &&
               shouldRetrySntp(wifiConnected, sntpSynced_, now, lastSntpAttemptAt_, kSntpRetryMs);
  if (start || retry) {
    startSntp();
    sntpStarted_ = true;
    lastSntpAttemptAt_ = now;
  }

  std::time_t epoch = std::time(nullptr);
  bool synchronized = sntpStarted_ && isSystemClockSynchronized(epoch);
  if (synchronized && !sntpSynced_) {
    sntpSynced_ = true;
    Serial.println("[clock] SNTP synced");
  }
  if (shouldPushRtc(synchronized, rtcPushed_)) {
    std::tm local{};
    if (localtime_r(&epoch, &local) != nullptr) {
      m5::rtc_datetime_t rtc{m5::rtc_date_t{local}, m5::rtc_time_t{local}};
      M5.Rtc.setDateTime(rtc);
      rtcPushed_ = true;
      Serial.printf("[clock] RTC set from SNTP: %04d-%02d-%02d %02d:%02d\n", rtc.date.year,
                    rtc.date.month, rtc.date.date, rtc.time.hours, rtc.time.minutes);
    }
  }

  if (wifiChannel != lastChannel_) {
    lastChannel_ = wifiChannel;
    if (wifiChannel != 0) {
      Serial.printf("[clock] fleet channel is now %d (follows the router)\n", wifiChannel);
    }
  }
#endif
}

EnvTimeSnapshot MainClock::wireTime() const {
  // The disciplined system clock outranks the free-running RTC; the RTC covers the
  // window before the first sync and a network where NTP never answers.
  std::time_t epoch = std::time(nullptr);
  bool systemSynced = sntpStarted_ && isSystemClockSynchronized(epoch);
  EnvTimeSnapshot system{EnvTimeSnapshot::kInvalid, EnvTimeSnapshot::kInvalid,
                         EnvTimeSnapshot::kInvalid};
  if (systemSynced) {
    std::tm local{};
    if (localtime_r(&epoch, &local) != nullptr) {
      system =
          makeEnvTimeSnapshot(local.tm_year + 1900, local.tm_hour, local.tm_min, local.tm_mon + 1);
    }
  }

  m5::rtc_datetime_t rtc = M5.Rtc.getDateTime();
  EnvTimeSnapshot rtcTime =
      makeEnvTimeSnapshot(rtc.date.year, rtc.time.hours, rtc.time.minutes, rtc.date.month);
  return selectWireTime(systemSynced, system, rtcTime);
}

}  // namespace hydra
