#pragma once
#include <cstdint>

#include "domain/i_clock.h"
#include "domain/i_watering_zone.h"
#include "domain/irrigation_policy.h"
#include "domain/pump_status.h"
#include "domain/soil_history.h"
#include "sub_node/app/irrigation_config.h"
#include "sub_node/app/timetable_executor.h"

namespace hydra {

// Orchestrates automatic irrigation for one or more zones. It owns per-zone
// runtime, soil history, fault tracking, and the current ESP-NOW environment
// context; callers interact through semantic watering commands and snapshots.
class IrrigationController {
 public:
  static constexpr int kMaxZones = 6;

  IrrigationController(IWateringZone** zones, int zoneCount,
                       const IrrigationConfig seasonalCfgs[kSeasonCount], IClock& clock)
      : zones_(zones),
        count_(zoneCount < kMaxZones ? zoneCount : kMaxZones),
        clock_(clock),
        season_(seasonFromClock(clock)) {
    for (int i = 0; i < kSeasonCount; i++) cfgs_[i] = seasonalCfgs[i];
    activeCfg_ = &cfgs_[static_cast<int>(season_)];
    for (int i = 0; i < kMaxZones; i++) executors_[i].configure(cfgs_);
    for (int i = 0; i < count_; i++) {
      rt_[i] = ZoneRuntime{PumpPhase::Idle, 0, 0, 0, 0, 0, false, 0.0f};
    }
  }

  void begin();
  void tick(uint32_t now);

  // ESP-NOW supplies the remote VPD/lux slice. An invalid slice suppresses only
  // wire-environment modulation; local drying-rate modulation remains active.
  void setEnvContext(const RemoteEnv& env) { remoteEnv_ = env; }

  struct StatusSnapshot {
    SoilReading soil;
    PumpStatus pumpStatus;
    uint8_t pulseCount;
    float effectiveDryPercent;
    float dryingRate;
    Season season;
    bool paused;
    bool fault;
    // Timetable outcome telemetry (v6). The executor's verdict on the last entry it
    // consumed, so the sub-node can carry it on its StatusReport. windowSeq is 0 until a
    // verdict exists, which is why the main node publishes nothing for it.
    uint32_t ttOutcomeWindowSeq;
    uint8_t ttOutcomeIndex;
    uint8_t ttOutcomeCode;
    uint8_t ttRanCount;
    uint8_t ttRefusedCount;
  };

  StatusSnapshot snapshot(int zone) const;

  // Local and remote force owners may overlap. The pump resumes automation only
  // after the last owner releases, so one source cannot cancel the other.
  void setLocalForceWatering(int zone, bool on, uint32_t now);
  void setRemoteForceWatering(int zone, bool on, uint32_t now);

  // A Window arrived for a zone (ADR-0006). A malformed Window, or one whose identity is
  // not newer than the live one, is refused and changes nothing, so the zone keeps the
  // loop it was already running. It replaces the per-tick Directive: the author weighed
  // state this device cannot see, and the Window then owns the zone's routine trigger for
  // its own bounded length.

  // A Window arrived for a zone (ADR-0006). A malformed Window, or one whose identity is
  // not newer than the live one, is refused and changes nothing, so the zone keeps
  // running whatever it was already running.
  bool installTimetable(int zone, const Timetable& table, uint32_t now);

  void setAutomationPaused(bool paused, uint32_t now);
  void clearFault(int zone);

  // One-shot serial-log handoff. The controller remains Serial-free.
  bool consumeCriticalOverride() const {
    bool value = criticalOverride_;
    criticalOverride_ = false;
    return value;
  }

  // One-shot handoff for the entry that just STARTED a cycle. Filed at the instant the
  // executor offers it, for the composition root to print; the controller stays Serial-free.
  // `night` is carried so a night watering is visible on the line, never so any policy can
  // read it -- the executor deliberately ignores the marker when deciding to start.
  struct TimetableEntryNotice {
    uint32_t windowSeq = 0;
    uint8_t index = 0;
    uint16_t offsetMinutes = 0;
    Plan intent = Plan::Standard;
    bool night = false;
  };

  bool consumeTimetableEntry(TimetableEntryNotice& out) const {
    if (!timetableEntryPending_) return false;
    out = timetableEntryNotice_;
    timetableEntryPending_ = false;
    return true;
  }

 private:
  bool computeWateringAllowed() const;
  bool abortNonCriticalCycle() const;
  bool allIdle() const;
  void setPaused(bool paused, uint32_t now);
  void forcePump(int zone, bool on, uint32_t now);
  void clearForceWatering(uint32_t now);
  void updateForceWatering(int zone, uint32_t now);
  bool hasForceWatering() const {
    for (int i = 0; i < count_; i++) {
      if (localForce_[i] || remoteForce_[i]) return true;
    }
    return false;
  }
  EnvContext envContextFor(int zone) const {
    return EnvContext{remoteEnv_.vpdKpa, remoteEnv_.lux, dryHistory_[zone].dryingRate(),
                      remoteEnv_.valid, dryHistory_[zone].valid()};
  }
  PumpStatus pumpStatusFor(int zone) const {
    return derivePumpStatus(fault_[zone], forced_[zone], rt_[zone].phase, paused_,
                            activeCfg_->disabled, timeBlocked_[zone]);
  }

  IWateringZone** zones_;
  int count_;
  IrrigationConfig cfgs_[kSeasonCount];
  const IrrigationConfig* activeCfg_;
  TimetableExecutor executors_[kMaxZones];
  IClock& clock_;
  Season season_;
  ZoneRuntime rt_[kMaxZones];
  SoilReading lastSoil_[kMaxZones] = {};
  float peakSoil_[kMaxZones] = {};
  bool paused_ = false;
  bool localForce_[kMaxZones] = {};
  bool remoteForce_[kMaxZones] = {};
  bool fault_[kMaxZones] = {};
  bool forced_[kMaxZones] = {};
  int weakCycleStreak_[kMaxZones] = {};
  uint32_t faultedAt_[kMaxZones] = {};
  bool timeBlocked_[kMaxZones] = {};
  bool criticalLogged_[kMaxZones] = {};
  mutable bool criticalOverride_ = false;
  mutable TimetableEntryNotice timetableEntryNotice_;
  mutable bool timetableEntryPending_ = false;
  RemoteEnv remoteEnv_ = defaultRemoteEnv();
  SoilHistory<config::kSoilHistorySize> dryHistory_[kMaxZones];
  uint32_t lastDryRecordAt_ = 0;
};

}  // namespace hydra
