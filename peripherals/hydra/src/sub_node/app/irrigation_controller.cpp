#include "sub_node/app/irrigation_controller.h"

#include "sub_node/app/irrigation_config.h"

namespace hydra {

void IrrigationController::begin() {
  for (int i = 0; i < count_; i++) zones_[i]->begin();
}

bool IrrigationController::computeWateringAllowed() const {
  // An unknown clock is possible during cold boot before the first EnvBroadcast.
  // Routine watering treats it as night; critical dryness remains the explicit
  // override. Runtime invalidates the clock when EnvBroadcast grows stale.
  return isAutonomousWateringAllowed(clock_, config::kWateringStartHour,
                                      config::kWateringEndHour);
}

bool IrrigationController::abortNonCriticalCycle() const {
  // A cold boot has no trusted time but no active automatic cycle either. Once
  // a cycle has begun, an invalid clock means the EnvBroadcast watchdog expired;
  // abort routine watering rather than carrying it through an unbounded outage.
  return !clock_.isValid();
}

bool IrrigationController::allIdle() const {
  for (int i = 0; i < count_; i++) {
    if (rt_[i].phase != PumpPhase::Idle) return false;
  }
  return true;
}

void IrrigationController::tick(uint32_t now) {
  // Seasonal config selection: latch only when all zones are idle, never mid-cycle.
  // Guarded on clock validity so an intermittent main node at the stale-window
  // boundary cannot flap season_ (and activeCfg_) every idle tick -- once the
  // clock is invalid the last-known-good season is held until a valid month
  // arrives again.
  if (clock_.isValid() && allIdle()) {
    Season s = seasonFromClock(clock_);
    if (s != season_) {
      season_ = s;
      activeCfg_ = &cfgs_[static_cast<int>(season_)];
    }
  }

  const IrrigationConfig& cfg = *activeCfg_;
  if (cfg.disabled) clearForceWatering(now);
  bool timeAllowed = computeWateringAllowed();

  // Sample soil into the per-zone drying-rate history, throttled to one per
  // minute. This is a local signal (no main node needed) feeding decidePump.
  bool recordDry = lastDryRecordAt_ == 0 || now - lastDryRecordAt_ >= config::kDryRecordMs;

  for (int i = 0; i < count_; i++) {
    SoilReading s = zones_[i]->readSoil();
    // One Directive gets at most one attempt: it is consumed here, before any
    // refusal can defer it, so a plan that cannot run now is gone rather than
    // parked until dormancy ends or a probe recovers.
    lastSoil_[i] = s;
    // Track the peak soil seen during a running cycle (PulseOn/SOAK). Judged at
    // EndCycle instead of the EndCycle instant, which lags percolation + EMA.
    if (s.valid && s.percent > peakSoil_[i]) peakSoil_[i] = s.percent;
    if (recordDry && s.valid) dryHistory_[i].record(s.percent, now);
    // The gate blocks against the same environment-modulated threshold the pump
    // decision uses. Comparing against the unmodulated seasonal threshold instead
    // reported a blocked zone as IDLE across the band between the two, which made a
    // multi-hour gate stall indistinguishable from a zone with nothing to do.
    const float effectiveDryPercent = modulateDryPercent(cfg.dryPercent, envContextFor(i));
    // Re-arming, from the two things that can justify another cycle once one has ended. The
    // soil coming back above the trigger is what "the last watering worked" looks like, and a
    // pot the probe never sees watered never recovers -- so it stops rather than being watered
    // on a timer. It is not never, though: a weak cycle can be probe lag or simply a small
    // dose, so the same dry soil is retried after the fault window, which is also how a run of
    // weak cycles reaches the three that latch the fault telling a human to look. Retrying
    // sooner than that is how one field zone ran four cycles in a day with its probe moving
    // +0.5, 0.0 and -0.2 %.
    if (rt_[i].phase == PumpPhase::Idle) {
      const bool recovered =
          s.valid && s.percent > effectiveDryPercent + config::kRearmMarginPercent;
      const bool retry = s.valid && s.percent <= effectiveDryPercent && rt_[i].everStopped &&
                         now - rt_[i].lastCycleEndedAt >= config::kFaultRetryMs;
      if (recovered || retry) rt_[i].armed = true;
    }
    // The stall guard's dry-spell clock is gone with the stall guard (ADR-0006): a Window
    // is bounded at four hours, so no supervised stretch can starve a zone for a period
    // worth measuring. Nothing here needs to remember how long the soil has been dry.
    //
    // Resolve whether this zone can run at all, then step the Window exactly once, BEFORE
    // honouring the skip. That ordering is what makes "a refused entry is discarded, never
    // deferred" true: a due entry is consumed at the instant it is due even when the zone
    // is paused, latched or under manual force.
    bool zoneServiceable = true;
    if (paused_) {
      zoneServiceable = false;  // manual mode: read for the display, don't auto-pump
    } else if (fault_[i]) {
      // Auto-recovery: a fault no longer latches forever. After the retry window
      // the zone clears itself and tries again; BtnA still clears it instantly.
      if (now - faultedAt_[i] >= config::kFaultRetryMs) {
        fault_[i] = false;
        weakCycleStreak_[i] = 0;
      } else {
        zoneServiceable = false;
      }
    }
    const TableStep table = executors_[i].step(rt_[i], s.valid, !zoneServiceable, now);
    // A Window carries the season its author reasoned under, so a tabulated cycle is
    // clamped by that preset rather than one derived from a clock the device may not
    // trust. Outside a Window the clock's season governs, exactly as it always did.
    IrrigationConfig zoneCfg = table.ownsTrigger ? cfgs_[static_cast<int>(table.season)] : cfg;
    // A probe that did not register the last cycle's water has not earned the benefit of the
    // doubt about this one: the wet cap is read from that same probe, and saturation is the
    // failure that kills the plant while a slightly early stop is one it recovers from. This
    // narrows the dose, not the trigger -- a pot that reads dry still gets watered.
    if (weakCycleStreak_[i] > 0 && zoneCfg.wetPercent > config::kCriticalPercent) {
      zoneCfg.wetPercent -= config::kUnconfirmedWetReductionPercent;
      if (zoneCfg.wetPercent < config::kCriticalPercent) {
        zoneCfg.wetPercent = config::kCriticalPercent;
      }
    }
    if (!zoneServiceable) continue;

    // Critical dryness overrides time-of-day block outside seasonal dormancy.
    bool criticalDry = !cfg.disabled && s.valid && s.percent <= cfg.criticalPercent;
    // A pot deeper than the trigger by more than the margin is in the drought-stress case: the
    // wide part of the day applies to it, because waiting for tomorrow costs growth. It still
    // needs a trustworthy clock -- an unknown hour is night, and watering blind at night is the
    // rot risk the gate exists for, so only critical dryness overrides that (unchanged).
    bool deeplyDry = timeAllowed && s.valid &&
                     s.percent <= effectiveDryPercent - config::kDeepDryMarginPercent;
    bool routineHour = timeAllowed &&
                       isRoutineWateringHour(clock_.currentHour(), config::kRoutineWateringEndHour);
    bool wateringAllowed = routineHour || deeplyDry || criticalDry;
    timeBlocked_[i] = !timeAllowed && !criticalDry && rt_[i].phase == PumpPhase::Idle &&
                      s.valid && s.percent <= effectiveDryPercent;
    // One-shot flag the rising edge of a critical-dry override so the serial line
    // (driven from main.cpp, which owns `Serial`) can log it once per cycle.
    if (criticalDry && !timeAllowed && !criticalLogged_[i] && rt_[i].phase == PumpPhase::Idle) {
      criticalLogged_[i] = true;
      criticalOverride_ = true;
    }

    PumpAction action = PumpAction::None;
    // The intent the cycle about to start runs under. On the device's own path this is the dose
    // the policy chose -- a nudge at the low edge of the band, a soak once the pot is really
    // dry or has not been watered in a day -- and a tabulated entry carries the author's own.
    Plan intent = Plan::Autonomous;
    if (table.ownsTrigger) {
      // A live Window owns the routine trigger, so the device's own threshold loop is not
      // consulted for the length of the Window: a Table with no entries is a real "water
      // nothing" rather than a gap for the threshold to fill. The critical-dryness
      // Actuator limit still starts a cycle because `wateringAllowed` is narrowed to it --
      // and that narrowing is the only way the idle branch is reached at all, so the
      // emergency is not suppressed by a held Window.
      //
      // A running cycle is deliberately not aborted by a stale clock here: the author is
      // the node that could see the hour, and the Window is local and bounded, so hub
      // silence no longer invalidates the intent the way it invalidated a Directive.
      if (table.startEntry) {
        action = PumpAction::PulseOn;
        intent = table.intent;
        timeBlocked_[i] = false;
        // File the one-shot log notice. `night` rides along so the composition root can
        // print it; nothing here consults it, which is what keeps the marker out of the
        // decision (ADR-0006: the device never gates on the author's day/night marker).
        timetableEntryNotice_ = TimetableEntryNotice{table.windowSeq, table.index,
                                                      table.offsetMinutes, table.intent,
                                                      table.night};
        timetableEntryPending_ = true;
      } else {
        action = decidePump(zoneCfg, rt_[i], s.percent, s.valid, now, criticalDry, false,
                            envContextFor(i));
      }
    } else {
      // No Window: the device's own threshold loop decides, gated by the clock and
      // modulated by the environment, exactly as it did before a Supervisor existed.
      // `zoneCfg`, not `cfg`: the narrowed wet cap has to bound the device's own cycle too,
      // which is where the unconfirmed probe actually is.
      // The dose: a nudge when the pot is only at the edge of its band and the last cycle was
      // confirmed and recent, a full soak otherwise.
      const bool absorptionConfirmed = weakCycleStreak_[i] == 0;
      const bool wateredRecently = rt_[i].everStopped &&
                                   now - rt_[i].lastCycleEndedAt <= config::kTopUpRecentMs;
      intent = autonomousPlan(s.percent, effectiveDryPercent, absorptionConfirmed, wateredRecently,
                              config::kTopUpBandPercent);
      action = decidePump(zoneCfg, rt_[i], s.percent, s.valid, now, wateringAllowed,
                          abortNonCriticalCycle(), envContextFor(i));
    }
    switch (action) {
      case PumpAction::PulseOn:
        zones_[i]->pump(true);
        if (rt_[i].phase == PumpPhase::Idle) {
          // Starting a new cycle
          rt_[i].pumpStartedAt = now;
          rt_[i].soilPercentStart = s.percent;
          rt_[i].pulseCount = 0;
          rt_[i].accumulatedOnMs = 0;
          peakSoil_[i] = s.percent;  // reset efficacy peak at cycle start
          // The profile this cycle runs under. A Plan may narrow the pulse cap or
          // lengthen the soak; an autonomous cycle keeps the seasonal preset. Set here,
          // at cycle start, so a later cycle cannot inherit the previous one's profile.
          PlanProfile profile = planProfile(intent, zoneCfg);
          rt_[i].cycleMaxPulses = profile.maxPulses;
          rt_[i].cycleSoakMs = profile.soakMs;
        }
        rt_[i].phase = PumpPhase::PulseOn;
        rt_[i].phaseStartedAt = now;
        rt_[i].pulseCount++;
        break;

      case PumpAction::PulseOff:
        zones_[i]->pump(false);
        rt_[i].accumulatedOnMs += now - rt_[i].phaseStartedAt;
        rt_[i].phase = PumpPhase::PulseOff;
        rt_[i].phaseStartedAt = now;
        break;

      case PumpAction::AbortCycle:
        zones_[i]->pump(false);
        rt_[i].phase = PumpPhase::Idle;
        rt_[i].lastCycleEndedAt = now;
        rt_[i].everStopped = true;
        rt_[i].armed = false;  // must recover above the trigger before the next attempt
        rt_[i].pulseCount = 0;
        rt_[i].accumulatedOnMs = 0;
        peakSoil_[i] = 0.0f;
        criticalLogged_[i] = false;
        timeBlocked_[i] = true;
        break;

      case PumpAction::EndCycle: {
        zones_[i]->pump(false);
        if (rt_[i].phase == PumpPhase::PulseOn) {
          rt_[i].accumulatedOnMs += now - rt_[i].phaseStartedAt;
        }
        // Efficacy check: a weak cycle (soil rose less than the delta) may just
        // be sensor lag, so a single one never faults. Only a run of consecutive
        // weak cycles -- spaced hours apart, so the soil has settled -- points to
        // a clogged pump or empty reservoir and flags a fault. Judged against the
        // cycle peak, not the EndCycle instant, so percolation/EMA lag does not
        // underreport the rise.
        const FaultConfig fc{config::kEfficacyMinDeltaPercent, config::kFaultAfterFailures};
        switch (evaluateCycle(fc, rt_[i].soilPercentStart, peakSoil_[i], s.valid,
                              rt_[i].pulseCount)) {
          case CycleEfficacy::Failed:
            if (++weakCycleStreak_[i] >= fc.maxConsecutiveFailures) {
              fault_[i] = true;
              faultedAt_[i] = now;
            }
            break;
          case CycleEfficacy::Ok:
            weakCycleStreak_[i] = 0;
            break;
          case CycleEfficacy::Unjudged:
            break;  // leave the streak untouched
        }
        rt_[i].phase = PumpPhase::Idle;
        rt_[i].lastCycleEndedAt = now;
        rt_[i].everStopped = true;
        rt_[i].armed = false;  // must recover above the trigger before the next attempt
        rt_[i].pulseCount = 0;
        rt_[i].accumulatedOnMs = 0;
        criticalLogged_[i] = false;
        timeBlocked_[i] = !timeAllowed && !criticalDry && s.valid &&
                          s.percent <= effectiveDryPercent;
        break;
      }

      case PumpAction::None:
        break;
    }
  }

  if (recordDry) lastDryRecordAt_ = now;
}

IrrigationController::StatusSnapshot IrrigationController::snapshot(int zone) const {
  if (zone < 0 || zone >= count_) return {};
  const TimetableExecutor::Outcome outcome = executors_[zone].outcome();
  return {lastSoil_[zone],
          pumpStatusFor(zone),
          static_cast<uint8_t>(rt_[zone].pulseCount),
          modulateDryPercent(activeCfg_->dryPercent, envContextFor(zone)),
          dryHistory_[zone].dryingRate(),
          season_,
          paused_,
          fault_[zone],
          outcome.windowSeq,
          outcome.index,
          outcome.code,
          outcome.ran,
          outcome.refused};
}

bool IrrigationController::installTimetable(int zone, const Timetable& table, uint32_t now) {
  if (zone < 0 || zone >= count_) return false;
  return executors_[zone].install(table, now);
}

void IrrigationController::setLocalForceWatering(int zone, bool on, uint32_t now) {
  if (zone < 0 || zone >= count_) return;
  if (activeCfg_->disabled) {
    clearForceWatering(now);
    return;
  }
  localForce_[zone] = on;
  updateForceWatering(zone, now);
}

void IrrigationController::setRemoteForceWatering(int zone, bool on, uint32_t now) {
  if (zone < 0 || zone >= count_) return;
  if (activeCfg_->disabled) {
    clearForceWatering(now);
    return;
  }
  remoteForce_[zone] = on;
  updateForceWatering(zone, now);
}

void IrrigationController::clearForceWatering(uint32_t now) {
  for (int i = 0; i < count_; i++) {
    localForce_[i] = false;
    remoteForce_[i] = false;
    criticalLogged_[i] = false;
    forcePump(i, false, now);
  }
  criticalOverride_ = false;
  setPaused(false, now);
}

void IrrigationController::updateForceWatering(int zone, uint32_t now) {
  if (activeCfg_->disabled) {
    clearForceWatering(now);
    return;
  }
  if (!hasForceWatering()) {
    forcePump(zone, false, now);
    setPaused(false, now);
    return;
  }

  if (!paused_) setPaused(true, now);
  for (int i = 0; i < count_; i++) {
    forcePump(i, localForce_[i] || remoteForce_[i], now);
  }
}

void IrrigationController::setAutomationPaused(bool paused, uint32_t now) {
  if (paused) {
    for (int i = 0; i < count_; i++) {
      localForce_[i] = false;
      remoteForce_[i] = false;
    }
  }
  setPaused(paused, now);
}

void IrrigationController::setPaused(bool paused, uint32_t now) {
  paused_ = paused;
  if (paused_) {
    for (int i = 0; i < count_; i++) {
      zones_[i]->pump(false);
      forced_[i] = false;  // pump is now off; clear any forced state
      if (rt_[i].phase != PumpPhase::Idle) {
        // Preserve cooldown: record when the cycle was interrupted
        rt_[i].lastCycleEndedAt = now;
        rt_[i].everStopped = true;
      }
      rt_[i].phase = PumpPhase::Idle;
      rt_[i].pulseCount = 0;
      rt_[i].accumulatedOnMs = 0;
      peakSoil_[i] = 0.0f;
    }
  }
}

void IrrigationController::forcePump(int zone, bool on, uint32_t now) {
  if (zone < 0 || zone >= count_) return;
  if (activeCfg_->disabled) on = false;
  // Cancel any in-progress pulse cycle
  if (rt_[zone].phase != PumpPhase::Idle) {
    rt_[zone].lastCycleEndedAt = now;
    rt_[zone].everStopped = true;
  }
  rt_[zone].phase = PumpPhase::Idle;
  rt_[zone].pulseCount = 0;
  rt_[zone].accumulatedOnMs = 0;
  peakSoil_[zone] = 0.0f;
  forced_[zone] = on;  // expose the forced pump so the fleet display shows WATER
  zones_[zone]->pump(on);
}

void IrrigationController::clearFault(int zone) {
  if (zone >= 0 && zone < count_) {
    fault_[zone] = false;
    weakCycleStreak_[zone] = 0;
  }
}

}  // namespace hydra
