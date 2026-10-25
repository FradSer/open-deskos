#pragma once
#include <cstdint>

#include "domain/irrigation_policy.h"
#include "domain/timetable.h"

// The program that executes a Timetable on the sub-node: the "device" half of ADR-0006.
//
// It holds one zone's live Timetable and answers one question per tick -- does a Window
// own this zone's routine trigger, and is an entry due? Header-only and pure (no Arduino,
// no GPIO, no NVS, no clock, no radio) for the same reason the other pure logic in this
// tree is: a whole four-hour Window has to be exercisable on the host in microseconds.
//
// What it deletes by existing: the Heartbeat, the Stand-down, the stall guard, the
// Directive, and the per-zone history (`lastDirective_`, `belowDry_*`) that derived
// authority from network liveness. Authority is now the boundedness of a Window.

namespace hydra {

struct TableStep {
  // True while a live Timetable owns this zone's routine trigger. The caller must not ask
  // the idle threshold question for the length of the Window; only a due entry and the
  // critical-dryness Actuator limit may start a cycle inside it.
  bool ownsTrigger = false;
  bool startEntry = false;  // an entry is due and may start now
  Plan intent = Plan::Standard;    // valid when startEntry
  Season season = Season::Summer;  // the season in force while the Window is live
  EntryRefusal refusal = EntryRefusal::None;  // why the entry just consumed was refused
  // The entry just consumed, for the one-line serial log. `night` is the author's usable-hours
  // marker -- water this pot cannot use before the low-evaporation night, which is only ever
  // authored as the drought-stress exception. It is carried so that shows in the log, never so
  // code can gate on it -- the
  // executor deliberately ignores it when deciding whether the entry may start.
  uint32_t windowSeq = 0;
  uint8_t index = 0;
  uint16_t offsetMinutes = 0;
  bool night = false;
};

class TimetableExecutor {
 public:
  TimetableExecutor() = default;

  explicit TimetableExecutor(const IrrigationConfig (&seasonalCfgs)[kSeasonCount]) {
    configure(seasonalCfgs);
  }

  // The seasonal presets outlive the executor and every zone shares them, so this holds a
  // reference to the composition root's array rather than a copy per zone. The
  // controller's constructor calls it for each zone.
  void configure(const IrrigationConfig (&seasonalCfgs)[kSeasonCount]) {
    seasonal_ = seasonalCfgs;
  }

  // The executor's verdict on the last entry it consumed, plus the live Window's counters.
  // `windowSeq` is 0 until an entry is consumed: a Window that is live but has had nothing
  // come due yet has no verdict to report, and reporting the Window with a zero entry would
  // claim an entry ran that did not. The main node publishes on this non-zero transition and
  // stays silent at zero ("no Table yet").
  struct Outcome {
    uint32_t windowSeq = 0;  // 0 = no verdict yet
    uint8_t index = 0;
    uint8_t code = 0;  // EntryRefusal code, 0 = RAN
    uint8_t ran = 0;
    uint8_t refused = 0;
  };

  Outcome outcome() const { return outcome_; }

  // A Window arrived. Validates, then commits: a false return changes nothing, so a
  // malformed frame cannot half-apply a Window. A `windowSeq` not newer than the one
  // already accepted is a no-op, which is what makes a broker re-delivery -- or an ESP-NOW
  // re-broadcast -- unable to re-arm a schedule whose entries have already been attempted.
  bool install(const Timetable& table, uint32_t now) {
    if (validateTimetable(table) != TimetableFault::Ok) return false;
    // Zero is not a Window identity. The MQTT parser refuses `@0` before this is reached,
    // so only a hand-crafted ESP-NOW frame can get here -- and if it did, the entries would
    // run while their outcome read as "no verdict" on the main node, which is the state a
    // zone with nothing to report is described by.
    if (table.windowSeq == 0) return false;
    if (everAccepted_ && table.windowSeq <= windowSeq_) return false;
    table_ = table;
    windowSeq_ = table.windowSeq;
    everAccepted_ = true;
    accepted_ = true;
    acceptedAt_ = now;
    cursor_ = 0;
    // A new Window starts with no verdict of its own. The counters are per-Window, so they
    // reset here; the main node's change detection keeps the LAST real verdict retained on
    // the broker rather than republishing a zero.
    outcome_ = Outcome{};
    return true;
  }

  // One question per tick. `rt` supplies the machine's own bounds (an idle zone, and the
  // inter-cycle gap); `soilValid` and `forceActive` supply the other two. Note what is NOT
  // a parameter: the soil percentage. A Timetable entry needs no dryness to start, exactly
  // as a Plan did not, so the table path cannot consult it even by accident.
  //
  // Call this for every zone every tick, BEFORE any paused or faulted skip: that ordering
  // is what makes "refused is discarded, never deferred" true, because a due entry is
  // consumed at the instant it is due even when the zone cannot run it.
  TableStep step(const ZoneRuntime& rt, bool soilValid, bool forceActive, uint32_t now) {
    TableStep out;
    expire(now);
    if (!accepted_) return out;  // no Window: the local loop owns the trigger

    out.ownsTrigger = true;
    out.season = table_.season;

    // At most one entry per call. Entries are validated strictly increasing, so offering
    // the first unconsumed one keeps the order the author wrote and lets the caller apply
    // it before the next tick sees the cycle it started.
    if (cursor_ >= table_.count) return out;

    const TimetableEntry& due = table_.entries[cursor_];
    if (now - acceptedAt_ < static_cast<uint32_t>(due.offsetMinutes) * 60UL * 1000UL) {
      return out;  // not yet due
    }

    cursor_++;  // consumed here, so every return below is a discard rather than a defer
    const IrrigationConfig& cfg = seasonal_[static_cast<int>(table_.season)];
    out.intent = due.intent;
    out.windowSeq = windowSeq_;
    out.index = static_cast<uint8_t>(cursor_ - 1);
    out.offsetMinutes = due.offsetMinutes;
    out.night = due.night;

    if (cfg.disabled) {
      out.refusal = EntryRefusal::Dormant;
    } else if (!soilValid) {
      out.refusal = EntryRefusal::Probe;
    } else if (forceActive) {
      out.refusal = EntryRefusal::Force;
    } else if (rt.phase != PumpPhase::Idle) {
      out.refusal = EntryRefusal::Busy;
    } else if (rt.everStopped && now - rt.lastCycleEndedAt < cfg.minIntervalMs) {
      out.refusal = EntryRefusal::MinGap;
    } else {
      out.startEntry = true;
    }
    recordOutcome(out);
    return out;
  }

  bool holdsWindow() const { return accepted_; }
  uint32_t acceptedSeq() const { return windowSeq_; }
  uint8_t remaining() const { return accepted_ ? static_cast<uint8_t>(table_.count - cursor_) : 0; }

 private:
  // One consumption, one verdict: `code` is the EntryRefusal the executor just decided (0
  // when the entry ran), and the Window's counters move with it. Called from every path that
  // consumes an entry, so "refused is discarded, never deferred" and "every entry leaves a
  // trace" are the same statement.
  void recordOutcome(const TableStep& step) {
    outcome_.windowSeq = step.windowSeq;
    outcome_.index = step.index;
    outcome_.code = static_cast<uint8_t>(step.refusal);
    if (step.startEntry) {
      outcome_.ran++;
    } else {
      outcome_.refused++;
    }
  }

  void expire(uint32_t now) {
    if (accepted_ && now - acceptedAt_ >= kWindowMs) accepted_ = false;
  }

  const IrrigationConfig* seasonal_ = nullptr;
  Timetable table_;
  uint32_t windowSeq_ = 0;
  uint32_t acceptedAt_ = 0;
  uint8_t cursor_ = 0;
  bool accepted_ = false;
  Outcome outcome_;
  // Survives expiry: the identity has to keep advancing, or a re-delivered old Window
  // could be accepted as new once the live one has lapsed.
  bool everAccepted_ = false;
};

}  // namespace hydra