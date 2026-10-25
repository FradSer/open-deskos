#pragma once
#include <cstdint>

#include "domain/irrigation_policy.h"
#include "domain/plan.h"

// The value the model authors once per Window, and the structural contract it has to
// satisfy (ADR-0006). Pure: no hardware, no clock, no configuration, so the same value
// crosses three seams -- the ESP-NOW frame on the device, a fixture on the host, and a
// model call on the NAS -- and every end agrees on "well formed" by construction.
//
// A Timetable ENTRY is an intent, never pulse parameters (ADR-0002): the device owns the
// intent-to-pulses table beside its seasonal presets and clamps it with the season the
// author declared.

namespace hydra {

// The Window's length is a code constant, not an author field. A model-declared validity
// invites the degenerate "valid for thirty years", and a bounded Window is the only reason
// a supervised stretch can no longer be unbounded -- and therefore the only reason the
// Heartbeat, the Stand-down and the stall guard are all deletable.
constexpr uint16_t kWindowMinutes = 240;
constexpr uint32_t kWindowMs = static_cast<uint32_t>(kWindowMinutes) * 60UL * 1000UL;

// How many entries one frame's entry list carries. Four is the wire's field width, which
// is also what the model is asked for.
constexpr uint8_t kMaxTimetableEntries = 4;

// Why a due entry could not run. All five are the machine's own bounds -- the four
// Actuator limits ADR-0006 keeps, plus a cycle already in flight -- never a policy. A
// refused entry is consumed and discarded, never deferred: an intent built on four-hour-old
// state is more dangerous than a lost one.
//
// The verdict now rides the wire (v6 outcome telemetry), so the enum lives in the shared
// pure domain beside the value it judges rather than in the executor that applies it. `None`
// is the code a consumed entry that RAN reports, which is why entryRefusalName() spells it
// RAN: a consumer never has to special-case 0.
enum class EntryRefusal : uint8_t { None, Dormant, Probe, Force, MinGap, Busy };

// Wire/log spelling of a refusal -- the way planName() spells a Plan. The MQTT outcome
// topic and the sub-node's serial line both read this one table.
inline const char* entryRefusalName(EntryRefusal refusal) {
  switch (refusal) {
    case EntryRefusal::None: return "RAN";
    case EntryRefusal::Dormant: return "DORMANT";
    case EntryRefusal::Probe: return "PROBE";
    case EntryRefusal::Force: return "FORCE";
    case EntryRefusal::MinGap: return "MIN_GAP";
    case EntryRefusal::Busy: return "BUSY";
  }
  return "?";
}

struct TimetableEntry {
  uint16_t offsetMinutes = 0;  // minutes from receipt, in [0, kWindowMinutes)
  Plan intent = Plan::Standard;
  // "Water this pot cannot use before the low-evaporation night", derived by the author from its
  // own clock. Not a darkness flag: an entry at 20:45 into a 20:00 Window is marked, because the
  // substrate then sits wet through the warm humid night the plant guidance names as the fungal
  // and rot window. The device carries and prints it, and never gates on it -- the bound is applied
  // where the hour is known, at authoring (ADR-0006 amendment 3).
  bool night = false;
};

// A Timetable always EXISTS. Its 0..4 entries may be none, and a Table with no entries is
// a real Table: "water nothing this Window". That is a different state from having no
// Timetable at all, which is what a failed authoring produces and what lets the local loop
// run. Conflating the two would either water a held plant or suspend the local policy for
// four hours on a timeout, so they are kept apart in the type from here on.
struct Timetable {
  uint32_t windowSeq = 0;        // the Window's identity: what anti-replay compares
  Season season = Season::Summer;  // declared by the author, never derived by the device
  uint8_t count = 0;             // 0 <= count <= kMaxTimetableEntries
  TimetableEntry entries[kMaxTimetableEntries] = {};
};

inline bool sameTimetable(const Timetable& a, const Timetable& b) {
  if (a.windowSeq != b.windowSeq || a.season != b.season || a.count != b.count || a.count > 4)
    return false;
  for (uint8_t i = 0; i < a.count; ++i)
    if (a.entries[i].offsetMinutes != b.entries[i].offsetMinutes ||
        a.entries[i].intent != b.entries[i].intent || a.entries[i].night != b.entries[i].night)
      return false;
  return true;
}

enum class TimetableFault : uint8_t {
  Ok,
  TooManyEntries,
  OffsetOutsideWindow,
  DuplicateOffset,
  OffsetsNotIncreasing,
  UnknownSeason,
  UnknownIntent,
  IntentDoesNotWater,
};

// Structural validation only: "is this a well-formed Timetable?", never "should this
// Timetable water?" (ADR-0006). A malformed Table is rejected WHOLE -- no part of it is
// executable -- because choosing which entries survive would be an edit to a judgment the
// model did not make.
//
// There is deliberately no policy branch here: no gate, no rot-risk veto, no confidence
// floor, no envelope. Those were `classic` Mode's clamp ladder and none of them survives.
inline TimetableFault validateTimetable(const Timetable& table) {
  if (table.count > kMaxTimetableEntries) return TimetableFault::TooManyEntries;
  if (static_cast<int>(table.season) < 0 || static_cast<int>(table.season) >= kSeasonCount) {
    return TimetableFault::UnknownSeason;
  }
  int previous = -1;
  for (uint8_t i = 0; i < table.count && i < kMaxTimetableEntries; i++) {
    const TimetableEntry& e = table.entries[i];
    // A byte this firmware cannot name is rejected before it is interpreted: `planWaters`
    // alone would accept any value that is not `Hold` or `Autonomous`, including a code
    // that names nothing at all.
    if (!isKnownPlan(static_cast<uint8_t>(e.intent))) return TimetableFault::UnknownIntent;
    // `hold` is zero entries and a release is no Timetable, so neither is an intent a
    // Timetable entry may carry.
    if (!planWaters(e.intent)) return TimetableFault::IntentDoesNotWater;
    if (e.offsetMinutes >= kWindowMinutes) return TimetableFault::OffsetOutsideWindow;
    if (previous >= 0 && e.offsetMinutes == previous) return TimetableFault::DuplicateOffset;
    if (previous >= 0 && e.offsetMinutes < previous) return TimetableFault::OffsetsNotIncreasing;
    previous = e.offsetMinutes;
  }
  return TimetableFault::Ok;
}

}  // namespace hydra