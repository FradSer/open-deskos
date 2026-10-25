// Host tests for the Timetable executor.
//
// Mirrors `firmware/features/timetable.feature`. The executor is pure: no Arduino, no
// GPIO, no NVS, no radio and no clock, so a whole four-hour Window is exercised here in
// microseconds. `step` is given a ZoneRuntime by hand, which is what makes every refusal
// path reachable without a plant.
#include <unity.h>

#include <initializer_list>

#include <sub_node/app/irrigation_config.h>
#include <sub_node/app/timetable_executor.h>

using namespace hydra;

namespace {

constexpr uint32_t kMinute = 60UL * 1000UL;

// A Window's worth of entries, built by hand. Nothing here constructs a frame: the
// fixture and the radio are two adapters over one value.
Timetable tableWith(Season season, uint32_t seq, std::initializer_list<TimetableEntry> list) {
  Timetable t{};
  t.season = season;
  t.windowSeq = seq;
  uint8_t i = 0;
  for (const TimetableEntry& e : list) {
    if (i < kMaxTimetableEntries) t.entries[i] = e;
    i++;
  }
  // Deliberately unclamped: a fixture must be able to build a malformed value, or the
  // structural rules have nothing to reject.
  t.count = i;
  return t;
}

TimetableEntry entry(uint16_t offsetMinutes, Plan intent, bool night = false) {
  return TimetableEntry{offsetMinutes, intent, night};
}

ZoneRuntime idleZone() {
  ZoneRuntime rt = ZoneRuntime{PumpPhase::Idle, 0, 0, 0, 0, 0, false, 0.0f};
  return rt;
}

ZoneRuntime runningZone() {
  ZoneRuntime rt = idleZone();
  rt.phase = PumpPhase::PulseOn;
  return rt;
}

ZoneRuntime zoneInGap(uint32_t now) {
  ZoneRuntime rt = idleZone();
  rt.everStopped = true;
  rt.lastCycleEndedAt = now - kMinute;  // well inside the seasonal minimum gap
  return rt;
}

}  // namespace

void setUp() {}
void tearDown() {}

// --- The Window owns the trigger -------------------------------------------------

void test_no_timetable_leaves_the_local_loop_in_charge() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();

  TableStep step = ex.step(rt, true, false, kMinute);

  TEST_ASSERT_FALSE(step.ownsTrigger);
  TEST_ASSERT_FALSE(step.startEntry);
}

void test_a_timetable_owns_the_trigger_for_its_whole_window() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(100, Plan::Standard)}), 0));

  TableStep step = ex.step(rt, true, false, 10 * kMinute);

  TEST_ASSERT_TRUE(step.ownsTrigger);
  TEST_ASSERT_FALSE(step.startEntry);
}

void test_a_timetable_of_no_entries_waters_nothing_and_still_owns_the_trigger() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {}), 0));

  TableStep step = ex.step(rt, true, false, 10 * kMinute);

  // Zero entries is an authored "water nothing", not an absence: the trigger stays
  // suspended for the whole Window and nothing waters.
  TEST_ASSERT_TRUE(step.ownsTrigger);
  TEST_ASSERT_FALSE(step.startEntry);
  TEST_ASSERT_EQUAL(0, ex.remaining());
}

void test_the_window_expires_and_hands_the_trigger_back() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::TopUp)}), 0));

  TEST_ASSERT_TRUE(ex.step(rt, true, false, 10 * kMinute).ownsTrigger);

  TableStep expired = ex.step(rt, true, false, kWindowMinutes * kMinute);

  TEST_ASSERT_FALSE(expired.ownsTrigger);
  TEST_ASSERT_FALSE(expired.startEntry);
}

// --- Entries ---------------------------------------------------------------------

void test_an_entry_starts_its_intent_at_its_own_offset() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::TopUp)}), 0));

  TEST_ASSERT_FALSE(ex.step(rt, true, false, 9 * kMinute).startEntry);

  TableStep due = ex.step(rt, true, false, 10 * kMinute);

  TEST_ASSERT_TRUE(due.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::TopUp), static_cast<int>(due.intent));
  TEST_ASSERT_EQUAL(static_cast<int>(Season::Summer), static_cast<int>(due.season));
}

void test_an_entry_is_attempted_once_and_never_re_offered() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  TEST_ASSERT_TRUE(ex.step(rt, true, false, 10 * kMinute).startEntry);
  TEST_ASSERT_FALSE(ex.step(rt, true, false, 11 * kMinute).startEntry);
  TEST_ASSERT_FALSE(ex.step(rt, true, false, 60 * kMinute).startEntry);
}

void test_entries_are_offered_in_offset_order_one_per_tick() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  Timetable t = tableWith(Season::Summer, 100,
                          {entry(10, Plan::TopUp), entry(11, Plan::Standard)});
  TEST_ASSERT_TRUE(ex.install(t, 0));

  // Two entries are past due at the same instant. Only the first is offered, so the
  // caller applies it and the next tick sees the cycle it started.
  TableStep first = ex.step(rt, true, false, 12 * kMinute);
  TEST_ASSERT_TRUE(first.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::TopUp), static_cast<int>(first.intent));
  TEST_ASSERT_TRUE(first.ownsTrigger);
}

// --- Refusal: discarded, never deferred -----------------------------------------

void test_an_entry_refused_by_the_gap_is_discarded_not_deferred() {
  TimetableExecutor ex(config::kSeasonal);
  const uint32_t now = 10 * kMinute;
  ZoneRuntime rt = zoneInGap(now);
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  TableStep refused = ex.step(rt, true, false, now);

  TEST_ASSERT_FALSE(refused.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(EntryRefusal::MinGap), static_cast<int>(refused.refusal));
  TEST_ASSERT_TRUE(refused.ownsTrigger);

  // The gap has since elapsed, and the entry is still gone: a stale intent applied
  // later is worse than a lost one.
  ZoneRuntime cooled = idleZone();
  TEST_ASSERT_FALSE(ex.step(cooled, true, false, 14 * kMinute).startEntry);
}

void test_a_dormant_declared_season_refuses_every_entry() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Winter, 100, {entry(10, Plan::Standard)}), 0));

  TableStep step = ex.step(rt, true, false, 10 * kMinute);

  TEST_ASSERT_FALSE(step.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(EntryRefusal::Dormant), static_cast<int>(step.refusal));
  TEST_ASSERT_TRUE(step.ownsTrigger);
}

void test_an_unreadable_probe_refuses_an_entry() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  TableStep step = ex.step(rt, /*soilValid=*/false, false, 10 * kMinute);

  TEST_ASSERT_FALSE(step.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(EntryRefusal::Probe), static_cast<int>(step.refusal));
}

void test_a_manual_force_refuses_an_entry_without_suspending_the_window() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  Timetable t = tableWith(Season::Summer, 100,
                          {entry(10, Plan::Standard), entry(100, Plan::TopUp)});
  TEST_ASSERT_TRUE(ex.install(t, 0));

  TableStep forced = ex.step(rt, true, /*forceActive=*/true, 10 * kMinute);

  TEST_ASSERT_FALSE(forced.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(EntryRefusal::Force), static_cast<int>(forced.refusal));
  TEST_ASSERT_TRUE(forced.ownsTrigger);

  // The force is for the zone, not for the Window: the later entry still stands.
  TableStep later = ex.step(rt, true, false, 100 * kMinute);
  TEST_ASSERT_TRUE(later.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::TopUp), static_cast<int>(later.intent));
}

void test_a_running_cycle_is_not_interrupted_by_a_due_entry() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = runningZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  TableStep step = ex.step(rt, true, false, 10 * kMinute);

  TEST_ASSERT_FALSE(step.startEntry);
  TEST_ASSERT_EQUAL(static_cast<int>(EntryRefusal::Busy), static_cast<int>(step.refusal));
  TEST_ASSERT_TRUE(step.ownsTrigger);
}

// --- Arrival ---------------------------------------------------------------------

void test_a_redelivered_window_does_not_re_arm_the_schedule() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  Timetable t = tableWith(Season::Summer, 100, {entry(10, Plan::Standard)});
  TEST_ASSERT_TRUE(ex.install(t, 0));
  TEST_ASSERT_TRUE(ex.step(rt, true, false, 10 * kMinute).startEntry);

  // A broker re-delivery of the same Window must not restart the clock on already
  // attempted entries.
  TEST_ASSERT_FALSE(ex.install(t, 200 * kMinute));

  TEST_ASSERT_EQUAL(100u, ex.acceptedSeq());
  TEST_ASSERT_FALSE(ex.step(rt, true, false, 201 * kMinute).startEntry);
}

void test_a_window_with_no_identity_is_refused() {
  // Zero is not a Window identity. The MQTT parser never emits one, so this is the ESP-NOW
  // seam: a hand-crafted frame must not install a Window whose verdict would read as
  // "no verdict" on the main node while its entries ran anyway.
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  Timetable t = tableWith(Season::Summer, 0, {entry(10, Plan::Standard)});

  TEST_ASSERT_FALSE(ex.install(t, 0));
  TEST_ASSERT_FALSE(ex.holdsWindow());
  TEST_ASSERT_FALSE(ex.step(rt, true, false, 10 * kMinute).ownsTrigger);
  TEST_ASSERT_FALSE(ex.step(rt, true, false, 10 * kMinute).startEntry);
}

void test_a_newer_window_replaces_the_live_one_from_its_own_receipt() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::TopUp)}), 0));

  const uint32_t receipt = 100 * kMinute;
  Timetable newer = tableWith(Season::Summer, 101, {entry(5, Plan::Standard)});
  TEST_ASSERT_TRUE(ex.install(newer, receipt));

  TEST_ASSERT_EQUAL(101u, ex.acceptedSeq());
  TEST_ASSERT_FALSE(ex.step(rt, true, false, receipt + 4 * kMinute).startEntry);
  TEST_ASSERT_TRUE(ex.step(rt, true, false, receipt + 5 * kMinute).startEntry);
}

void test_offsets_are_measured_from_receipt_and_never_from_a_clock() {
  // The same elapsed time from a different instant yields the same entry: nothing in
  // the executor can tell what time of day it is.
  TimetableExecutor morning(config::kSeasonal);
  TimetableExecutor night(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  Timetable t = tableWith(Season::Summer, 100, {entry(10, Plan::Standard)});

  const uint32_t atDawn = 6 * 60 * kMinute;
  const uint32_t atDusk = 20 * 60 * kMinute;
  TEST_ASSERT_TRUE(morning.install(t, atDawn));
  TEST_ASSERT_TRUE(night.install(t, atDusk));

  TEST_ASSERT_TRUE(morning.step(rt, true, false, atDawn + 10 * kMinute).startEntry);
  TEST_ASSERT_TRUE(night.step(rt, true, false, atDusk + 10 * kMinute).startEntry);
}

// --- Structural validation: the only rejection -----------------------------------

void test_a_malformed_timetable_is_rejected_whole() {
  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::TooManyEntries),
                    static_cast<int>(validateTimetable(tableWith(
                        Season::Summer, 1,
                        {entry(1, Plan::TopUp), entry(2, Plan::TopUp), entry(3, Plan::TopUp),
                         entry(4, Plan::TopUp), entry(5, Plan::TopUp)}))));

  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::OffsetOutsideWindow),
                    static_cast<int>(validateTimetable(
                        tableWith(Season::Summer, 1, {entry(kWindowMinutes, Plan::TopUp)}))));

  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::DuplicateOffset),
                    static_cast<int>(validateTimetable(tableWith(
                        Season::Summer, 1, {entry(10, Plan::TopUp), entry(10, Plan::Standard)}))));

  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::OffsetsNotIncreasing),
                    static_cast<int>(validateTimetable(tableWith(
                        Season::Summer, 1, {entry(20, Plan::TopUp), entry(10, Plan::Standard)}))));

  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::UnknownSeason),
                    static_cast<int>(validateTimetable(
                        tableWith(static_cast<Season>(kSeasonCount), 1, {}))));

  // An intent that does not water is not a Timetable entry. Holding is zero entries
  // and releasing is no Timetable, so neither belongs in the entry vocabulary.
  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::IntentDoesNotWater),
                    static_cast<int>(validateTimetable(
                        tableWith(Season::Summer, 1, {entry(10, Plan::Hold)}))));
  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::IntentDoesNotWater),
                    static_cast<int>(validateTimetable(
                        tableWith(Season::Summer, 1, {entry(10, Plan::Autonomous)}))));

  // A code that names nothing at all. `planWaters` would accept it -- it is neither
  // `Hold` nor `Autonomous` -- so the nameability check has to come first.
  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::UnknownIntent),
                    static_cast<int>(validateTimetable(
                        tableWith(Season::Summer, 1, {entry(10, static_cast<Plan>(99))}))));

  // A well-formed table, including an empty one, passes.
  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::Ok),
                    static_cast<int>(validateTimetable(tableWith(Season::Summer, 1, {}))));
  TEST_ASSERT_EQUAL(static_cast<int>(TimetableFault::Ok),
                    static_cast<int>(validateTimetable(tableWith(
                        Season::Summer, 1, {entry(0, Plan::TopUp), entry(239, Plan::DeepSoak)}))));
}

void test_a_rejected_timetable_leaves_a_held_window_running() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  Timetable malformed = tableWith(Season::Summer, 101, {entry(5, Plan::Hold)});
  TEST_ASSERT_FALSE(ex.install(malformed, kMinute));

  // The held Window keeps its identity and keeps owning the trigger.
  TEST_ASSERT_EQUAL(100u, ex.acceptedSeq());
  TableStep step = ex.step(rt, true, false, 10 * kMinute);
  TEST_ASSERT_TRUE(step.ownsTrigger);
  TEST_ASSERT_TRUE(step.startEntry);
}

void test_the_executor_refuses_a_timetable_with_an_unnameable_intent() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();

  TEST_ASSERT_FALSE(ex.install(
      tableWith(Season::Summer, 100, {entry(10, static_cast<Plan>(99))}), 0));
  TEST_ASSERT_FALSE(ex.holdsWindow());
  TEST_ASSERT_FALSE(ex.step(rt, true, false, 10 * kMinute).ownsTrigger);
}

// --- The night marker: carried and reported, never a gate ------------------------

void test_a_night_entry_still_starts_its_cycle() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(
      ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard, true)}), 0));

  TableStep step = ex.step(rt, true, false, 10 * kMinute);

  // The marker is the author's, not a policy: an entry it flags still waters. Code must
  // never refuse or alter an entry because of it (ADR-0006).
  TEST_ASSERT_TRUE(step.startEntry);
  TEST_ASSERT_TRUE(step.night);
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::Standard), static_cast<int>(step.intent));
}

void test_the_started_entry_carries_its_window_index_offset_and_marker() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(
      tableWith(Season::Summer, 100,
                {entry(5, Plan::TopUp, false), entry(95, Plan::Standard, true)}),
      0));

  TableStep first = ex.step(rt, true, false, 5 * kMinute);
  TEST_ASSERT_TRUE(first.startEntry);
  TEST_ASSERT_EQUAL_UINT32(100u, first.windowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, first.index);
  TEST_ASSERT_EQUAL_UINT16(5, first.offsetMinutes);
  TEST_ASSERT_FALSE(first.night);

  TableStep second = ex.step(rt, true, false, 95 * kMinute);
  TEST_ASSERT_TRUE(second.startEntry);
  TEST_ASSERT_EQUAL_UINT8(1, second.index);
  TEST_ASSERT_EQUAL_UINT16(95, second.offsetMinutes);
  TEST_ASSERT_TRUE(second.night);
}

// --- The outcome the author reads back ------------------------------------------

void test_an_outcome_records_the_entry_that_ran() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  // A live Window with nothing consumed reports no verdict: reporting the Window with a
  // zero entry would claim entry 0 ran, which it did not.
  TEST_ASSERT_EQUAL_UINT32(0u, ex.outcome().windowSeq);

  TEST_ASSERT_TRUE(ex.step(rt, true, false, 10 * kMinute).startEntry);

  TEST_ASSERT_EQUAL_UINT32(100u, ex.outcome().windowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, ex.outcome().index);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EntryRefusal::None), ex.outcome().code);
  TEST_ASSERT_EQUAL_UINT8(1, ex.outcome().ran);
  TEST_ASSERT_EQUAL_UINT8(0, ex.outcome().refused);
}

void test_a_refused_entry_records_the_code_that_refused_it() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));

  TableStep refused = ex.step(rt, /*soilValid=*/false, false, 10 * kMinute);

  TEST_ASSERT_TRUE(refused.ownsTrigger);
  TEST_ASSERT_EQUAL_UINT32(100u, ex.outcome().windowSeq);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EntryRefusal::Probe), ex.outcome().code);
  TEST_ASSERT_EQUAL_UINT8(0, ex.outcome().ran);
  TEST_ASSERT_EQUAL_UINT8(1, ex.outcome().refused);
}

void test_every_entry_that_ran_is_counted_for_the_window() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(
      tableWith(Season::Summer, 100,
                {entry(10, Plan::TopUp), entry(20, Plan::Standard)}),
      0));

  TEST_ASSERT_TRUE(ex.step(rt, true, false, 10 * kMinute).startEntry);
  TEST_ASSERT_TRUE(ex.step(rt, true, false, 20 * kMinute).startEntry);

  TEST_ASSERT_EQUAL_UINT8(1, ex.outcome().index);
  TEST_ASSERT_EQUAL_UINT8(2, ex.outcome().ran);
  TEST_ASSERT_EQUAL_UINT8(0, ex.outcome().refused);
}

void test_a_new_window_starts_its_counters_at_zero_with_no_verdict() {
  TimetableExecutor ex(config::kSeasonal);
  ZoneRuntime rt = idleZone();
  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 100, {entry(10, Plan::Standard)}), 0));
  TEST_ASSERT_TRUE(ex.step(rt, true, false, 10 * kMinute).startEntry);
  TEST_ASSERT_EQUAL_UINT8(1, ex.outcome().ran);

  TEST_ASSERT_TRUE(ex.install(tableWith(Season::Summer, 101, {entry(5, Plan::TopUp)}),
                              100 * kMinute));

  // The new Window has no verdict of its own until one of its entries is consumed, and its
  // counters start over -- they are per-Window, as the wire names them.
  TEST_ASSERT_EQUAL_UINT32(0u, ex.outcome().windowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, ex.outcome().ran);
  TEST_ASSERT_TRUE(ex.step(rt, true, false, 105 * kMinute).startEntry);
  TEST_ASSERT_EQUAL_UINT32(101u, ex.outcome().windowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, ex.outcome().index);
  TEST_ASSERT_EQUAL_UINT8(1, ex.outcome().ran);
}

void test_entry_refusal_names_the_outcome_the_way_the_topic_spells_it() {
  TEST_ASSERT_EQUAL_STRING("RAN", entryRefusalName(EntryRefusal::None));
  TEST_ASSERT_EQUAL_STRING("DORMANT", entryRefusalName(EntryRefusal::Dormant));
  TEST_ASSERT_EQUAL_STRING("PROBE", entryRefusalName(EntryRefusal::Probe));
  TEST_ASSERT_EQUAL_STRING("FORCE", entryRefusalName(EntryRefusal::Force));
  TEST_ASSERT_EQUAL_STRING("MIN_GAP", entryRefusalName(EntryRefusal::MinGap));
  TEST_ASSERT_EQUAL_STRING("BUSY", entryRefusalName(EntryRefusal::Busy));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_no_timetable_leaves_the_local_loop_in_charge);
  RUN_TEST(test_a_timetable_owns_the_trigger_for_its_whole_window);
  RUN_TEST(test_a_timetable_of_no_entries_waters_nothing_and_still_owns_the_trigger);
  RUN_TEST(test_the_window_expires_and_hands_the_trigger_back);
  RUN_TEST(test_an_entry_starts_its_intent_at_its_own_offset);
  RUN_TEST(test_an_entry_is_attempted_once_and_never_re_offered);
  RUN_TEST(test_entries_are_offered_in_offset_order_one_per_tick);
  RUN_TEST(test_an_entry_refused_by_the_gap_is_discarded_not_deferred);
  RUN_TEST(test_a_dormant_declared_season_refuses_every_entry);
  RUN_TEST(test_an_unreadable_probe_refuses_an_entry);
  RUN_TEST(test_a_manual_force_refuses_an_entry_without_suspending_the_window);
  RUN_TEST(test_a_running_cycle_is_not_interrupted_by_a_due_entry);
  RUN_TEST(test_a_redelivered_window_does_not_re_arm_the_schedule);
  RUN_TEST(test_a_window_with_no_identity_is_refused);
  RUN_TEST(test_a_newer_window_replaces_the_live_one_from_its_own_receipt);
  RUN_TEST(test_offsets_are_measured_from_receipt_and_never_from_a_clock);
  RUN_TEST(test_a_malformed_timetable_is_rejected_whole);
  RUN_TEST(test_a_rejected_timetable_leaves_a_held_window_running);
  RUN_TEST(test_the_executor_refuses_a_timetable_with_an_unnameable_intent);
  RUN_TEST(test_a_night_entry_still_starts_its_cycle);
  RUN_TEST(test_the_started_entry_carries_its_window_index_offset_and_marker);
  RUN_TEST(test_an_outcome_records_the_entry_that_ran);
  RUN_TEST(test_a_refused_entry_records_the_code_that_refused_it);
  RUN_TEST(test_every_entry_that_ran_is_counted_for_the_window);
  RUN_TEST(test_a_new_window_starts_its_counters_at_zero_with_no_verdict);
  RUN_TEST(test_entry_refusal_names_the_outcome_the_way_the_topic_spells_it);
  return UNITY_END();
}