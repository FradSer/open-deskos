#include <unity.h>

#include <initializer_list>

#include <sub_node/app/irrigation_controller.cpp>
#include <sub_node/app/sub_runtime.h>
#include <sub_node/hal/wire_clock.h>

using namespace hydra;

namespace {

class FakeClock : public IClock {
 public:
  FakeClock(bool valid, int hour, int month) : valid_(valid), hour_(hour), month_(month) {}

  int currentHour() const override { return hour_; }
  int currentMonth() const override { return month_; }
  bool isValid() const override { return valid_; }
  void setValid(bool valid) { valid_ = valid; }
  void setMonth(int month) { month_ = month; }

 private:
  bool valid_;
  int hour_;
  int month_;
};

class FakeWateringZone : public IWateringZone {
 public:
  explicit FakeWateringZone(float soilPercent) : reading_{0, soilPercent, true} {}

  bool begin() override { return true; }
  SoilReading readSoil() override { return reading_; }
  void pump(bool on) override { pumpOn_ = on; }

  bool pumpOn() const { return pumpOn_; }
  void setSoil(float percent) { reading_.percent = percent; }
  void setValid(bool valid) { reading_.valid = valid; }

 private:
  SoilReading reading_;
  bool pumpOn_ = false;
};

}  // namespace

void setUp() {}
void tearDown() {}

// Regression: time-block state belongs to the zone whose soil reading triggered it.
void test_night_gate_status_is_independent_per_zone() {
  FakeClock clock(true, 22, 7);
  FakeWateringZone waitingZone(45.0f);
  FakeWateringZone idleZone(60.0f);
  IWateringZone* zones[] = {&waitingZone, &idleZone};
  IrrigationController controller(zones, 2, config::kSeasonal, clock);

  controller.begin();
  controller.tick(1000U);

  TEST_ASSERT_FALSE(waitingZone.pumpOn());
  TEST_ASSERT_FALSE(idleZone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Wait, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_EQUAL(PumpStatus::Idle, controller.snapshot(1).pumpStatus);
}

// --- Supervised watering (mirrors features/supervised_watering.feature) ---

// Scenario: A standard plan delivers the seasonal pulse profile.
// Scenario: A directive is not blocked by the time-of-day gate, and a plan needs
// no soil dryness to start -- the decider already weighed both.
// Scenario: A directive for one zone does not drive another zone's pump.
// Scenario: A standard plan delivers the seasonal pulse profile end to end: ten
// pulses three seconds on and thirty seconds off, then the cycle ends. Counts the
// pump edges the zone actually sees, so the profile cannot drift from the preset.
// Drive one plan to completion under a given seasonal pulse cap and return the number of
// pulse edges the zone actually saw.
int pulsesForPlan(Plan plan, int seasonalCap) {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(52.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationConfig presets[kSeasonCount];
  for (int i = 0; i < kSeasonCount; i++) presets[i] = config::kSeasonal[i];
  presets[static_cast<int>(Season::Summer)].pulse.maxPulses = seasonalCap;
  IrrigationController controller(zones, 1, presets, clock);

  controller.begin();

  // A Window's entry carries the intent and the device still owns the dose, so the profile
  // clamp is unchanged: the assertion is about the intent-to-pulse table, not about who
  // asked. The entry sits at offset 0, so it is due on the first tick after it arrives.
  Timetable table{};
  table.windowSeq = 1;
  table.season = Season::Summer;
  table.count = 1;
  table.entries[0] = TimetableEntry{0, plan, false};
  controller.installTimetable(0, table, 1000U);

  int pumpStarts = 0;
  bool wasOn = false;
  for (uint32_t now = 1000U; now < 1200000U; now += 500U) {
    controller.tick(now);
    bool on = zone.pumpOn();
    if (on && !wasOn) pumpStarts++;
    wasOn = on;
  }
  return pumpStarts;
}

// Scenario: A top-up plan delivers fewer pulses than a standard plan. The seasonal
// profile allows ten; a top-up asks for two, so the count is the plan's and not the
// preset's -- which is exactly what was missing while only `standard` watered.
// Scenario: A deep-soak plan soaks twice as long between pulses. Same pulse count as
// the seasonal profile, twice the soak, so the period between pulse starts doubles.
// Scenario: A plan never exceeds the seasonal caps. Asserted at the request, one above
// it, and below it: with room the plan's own count stands, and with the preset tighter
// than the request the preset wins. The seasonal profile still runs to its own cap.
void test_a_plan_is_clamped_by_the_seasonal_pulse_cap() {
  TEST_ASSERT_EQUAL_INT(2, pulsesForPlan(Plan::TopUp, 2));  // at the cap
  TEST_ASSERT_EQUAL_INT(2, pulsesForPlan(Plan::TopUp, 3));  // room under the cap
  TEST_ASSERT_EQUAL_INT(1, pulsesForPlan(Plan::TopUp, 1));  // clamped by the cap
  TEST_ASSERT_EQUAL_INT(3, pulsesForPlan(Plan::Standard, 3));
}

// Scenario: A plan never interrupts a running cycle, and one that arrives mid-cycle
// is discarded rather than queued -- the Supervisor's next tick sends a fresh one,
// and a stale intent applied later is worse than a lost one.
// Scenarios: a Plan that cannot run at the next tick is discarded rather than
// parked (F1), and one arriving during a manual force does not survive the force
// (F2) -- releasing a force must not start an unattended cycle from a stale intent.
// Regression: a closed gate must report WAIT whenever the zone is dry against the
// environment-modulated effective threshold, not only against the unmodulated
// seasonal one. Between the two thresholds a blocked zone used to report IDLE,
// hiding a multi-hour gate stall behind a healthy-looking status.
void test_closed_gate_reports_wait_for_the_modulated_band() {
  FakeClock clock(true, 22, 7);  // Outside 6-21; July latches Summer (dry 50).
  FakeWateringZone modulatedZone(52.0f);  // Above 50, below the modulated 55.
  FakeWateringZone saturatedZone(60.0f);  // Above both.
  IWateringZone* zones[] = {&modulatedZone, &saturatedZone};
  IrrigationController controller(zones, 2, config::kSeasonal, clock);

  controller.begin();
  controller.setEnvContext(RemoteEnv{2.5f, 5000.0f, true});
  controller.tick(1000U);

  TEST_ASSERT_FALSE(modulatedZone.pumpOn());
  TEST_ASSERT_FALSE(saturatedZone.pumpOn());
  TEST_ASSERT_EQUAL_FLOAT(55.0f, controller.snapshot(0).effectiveDryPercent);
  TEST_ASSERT_EQUAL(PumpStatus::Wait, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_EQUAL(PumpStatus::Idle, controller.snapshot(1).pumpStatus);
}

// Invalid time is night: routine dryness waits, but critical dryness overrides.
void test_invalid_clock_blocks_routine_and_allows_critical_dryness() {
  FakeClock clock(false, 12, 7);
  FakeWateringZone routineZone(40.0f);
  FakeWateringZone criticalZone(25.0f);
  IWateringZone* zones[] = {&routineZone, &criticalZone};
  IrrigationController controller(zones, 2, config::kSeasonal, clock);

  controller.begin();
  controller.tick(1000U);

  TEST_ASSERT_FALSE(routineZone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Wait, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_TRUE(criticalZone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Pulse, controller.snapshot(1).pumpStatus);
}

// A known January latches the dormant config. If the clock subsequently goes
// stale, winter's zero critical threshold must not turn a valid zero reading
// into an emergency override.
void test_winter_dormancy_suppresses_zero_soil_critical_override_after_clock_stales() {
  FakeClock clock(true, 12, 1);
  FakeWateringZone zone(0.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);

  controller.begin();
  controller.tick(1000U);
  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Dormant, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_FALSE(controller.consumeCriticalOverride());

  clock.setValid(false);
  controller.tick(2000U);
  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Dormant, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_FALSE(controller.consumeCriticalOverride());
}

void test_clock_staleness_aborts_routine_cycle_and_fresh_time_restores_day_gate() {
  WireClock clock;
  clock.update(12, 0, 7, 100U);
  FakeWateringZone routineZone(40.0f);
  FakeWateringZone criticalZone(25.0f);
  IWateringZone* zones[] = {&routineZone, &criticalZone};
  IrrigationController controller(zones, 2, config::kSeasonal, clock);

  controller.begin();
  controller.tick(1000U);
  TEST_ASSERT_TRUE(routineZone.pumpOn());
  TEST_ASSERT_TRUE(criticalZone.pumpOn());

  constexpr uint32_t envReceivedAt = 100U;
  constexpr uint32_t staleAt = envReceivedAt + config::kEnvStaleMs;
  if (isEnvironmentStale(staleAt, envReceivedAt, config::kEnvStaleMs)) {
    clock.invalidate();  // Same timeout transition as SubRuntime.
  }
  controller.tick(staleAt);
  TEST_ASSERT_FALSE(routineZone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Wait, controller.snapshot(0).pumpStatus);
  // Critical soil is eligible to continue, but the normal pulse safety cap may
  // finish its already-running cycle at this later timestamp.
  TEST_ASSERT_FALSE(criticalZone.pumpOn());

  controller.tick(staleAt + 35000U);
  TEST_ASSERT_FALSE(routineZone.pumpOn());
  TEST_ASSERT_EQUAL(PumpStatus::Wait, controller.snapshot(0).pumpStatus);

  clock.update(12, 0, 7, staleAt + 35200U);
  IWateringZone* restoredZones[] = {&routineZone};
  IrrigationController restored(restoredZones, 1, config::kSeasonal, clock);
  restored.begin();
  restored.tick(staleAt + 40000U);
  TEST_ASSERT_TRUE(clock.isValid());
  TEST_ASSERT_TRUE(routineZone.pumpOn());
}

// Scenario: A controller snapshot carries one zone's reportable state.
void test_snapshot_groups_zone_observability() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(60.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);

  controller.begin();
  controller.tick(1000U);
  IrrigationController::StatusSnapshot snapshot = controller.snapshot(0);

  TEST_ASSERT_FLOAT_WITHIN(0.01f, 60.0f, snapshot.soil.percent);
  TEST_ASSERT_EQUAL(PumpStatus::Idle, snapshot.pumpStatus);
  TEST_ASSERT_EQUAL_UINT8(0, snapshot.pulseCount);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, snapshot.effectiveDryPercent);
  TEST_ASSERT_EQUAL(Season::Summer, snapshot.season);
  TEST_ASSERT_FALSE(snapshot.paused);
  TEST_ASSERT_FALSE(snapshot.fault);
}

// Local and remote owners overlap: the first release cannot cancel the other.
void test_force_ownership_requires_both_sources_to_release() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(60.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);

  controller.begin();
  controller.setRemoteForceWatering(0, true, 1000U);
  controller.setLocalForceWatering(0, true, 1100U);
  controller.setRemoteForceWatering(0, false, 1200U);

  TEST_ASSERT_TRUE(zone.pumpOn());
  TEST_ASSERT_TRUE(controller.snapshot(0).paused);
  TEST_ASSERT_EQUAL(PumpStatus::Watering, controller.snapshot(0).pumpStatus);

  controller.setLocalForceWatering(0, false, 1300U);
  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_FALSE(controller.snapshot(0).paused);
  TEST_ASSERT_EQUAL(PumpStatus::Idle, controller.snapshot(0).pumpStatus);
}

void test_winter_dormancy_rejects_local_force_watering() {
  FakeClock clock(true, 12, 1);
  FakeWateringZone zone(0.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);

  controller.begin();
  controller.setLocalForceWatering(0, true, 1000U);

  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_FALSE(controller.snapshot(0).paused);
  TEST_ASSERT_EQUAL(PumpStatus::Dormant, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_NOT_EQUAL(PumpStatus::Watering, controller.snapshot(0).pumpStatus);
}

void test_winter_dormancy_rejects_remote_force_watering() {
  FakeClock clock(true, 12, 1);
  FakeWateringZone zone(0.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);

  controller.begin();
  controller.setRemoteForceWatering(0, true, 1000U);

  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_FALSE(controller.snapshot(0).paused);
  TEST_ASSERT_EQUAL(PumpStatus::Dormant, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_NOT_EQUAL(PumpStatus::Watering, controller.snapshot(0).pumpStatus);
}

void test_winter_transition_clears_active_force_owners_and_pump() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(60.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);

  controller.begin();
  controller.setLocalForceWatering(0, true, 1000U);
  controller.setRemoteForceWatering(0, true, 1100U);
  TEST_ASSERT_TRUE(zone.pumpOn());
  TEST_ASSERT_TRUE(controller.snapshot(0).paused);

  // Forced zones remain phase-idle, so the production allIdle latch selects
  // Winter at this next tick and must revoke both owners before GPIO can run.
  clock.setMonth(1);
  controller.tick(1200U);

  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_FALSE(controller.snapshot(0).paused);
  TEST_ASSERT_EQUAL(PumpStatus::Dormant, controller.snapshot(0).pumpStatus);
  TEST_ASSERT_NOT_EQUAL(PumpStatus::Watering, controller.snapshot(0).pumpStatus);

  // Releasing one former owner after summer returns must not resurrect the
  // other: winter selection cleared both ownership bits.
  clock.setMonth(7);
  controller.tick(1300U);
  controller.setRemoteForceWatering(0, false, 1400U);
  TEST_ASSERT_FALSE(zone.pumpOn());
  TEST_ASSERT_FALSE(controller.snapshot(0).paused);
  TEST_ASSERT_EQUAL(PumpStatus::Idle, controller.snapshot(0).pumpStatus);
}

void test_force_ownership_is_local_to_its_zone() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone first(60.0f);
  FakeWateringZone second(60.0f);
  IWateringZone* zones[] = {&first, &second};
  IrrigationController controller(zones, 2, config::kSeasonal, clock);

  controller.begin();
  controller.setLocalForceWatering(0, true, 1000U);
  controller.setRemoteForceWatering(1, true, 1100U);
  controller.setLocalForceWatering(0, false, 1200U);

  TEST_ASSERT_FALSE(first.pumpOn());
  TEST_ASSERT_TRUE(second.pumpOn());
}

// --- Supervision (ticket 04) -------------------------------------------------

// Scenario: A supervised zone waits for a plan instead of self-triggering. A hold is the
// Supervisor withholding a cycle, so the zone's own dry-threshold trigger stands down for
// as long as the heartbeat is fresh. Before the stand-down existed a hold fell straight
// through to that trigger on the same tick, so `plan/ack hold` described an intent the
// device did not uphold (review finding F8).
// Scenario: Supervision lapses when plans stop arriving. One heartbeat timeout after the
// last Directive the zone is Autonomous again and self-triggers on its own threshold.
// Scenario: A release makes a zone autonomous at once, without waiting out the timeout.
// Scenario: Critical dryness starts a cycle while supervised and holding. No Directive and
// no gate survives a critical reading (ADR-0001), so the stand-down is not an exception.
// Scenario: A supervised zone with no watering lapses on its own. Hold Directives keep
// arriving, so the heartbeat never lapses and only the stall guard can save the zone --
// which is the point, because a live Supervisor holding forever starves the plant exactly
// as a dead one would.
// Scenario: The stand-down is its own state, not the gate's. Below the effective threshold
// in daylight a held zone reports IDLE -- nothing to do -- while the same zone at night
// still reports WAIT, because the gate is what is holding it back. Reporting the stand-down
// as a gate would make the two indistinguishable, which is the confusion ticket 02 fixed.
// --- Review follow-ups (ticket 04/05 review) -------------------------------

// Finding 1: the stall clock is an observation, so it must be observed. Soil that went wet
// and then dry again during a long manual pause restarts the clock, and the guard does not
// fire on the first tick afterwards as though the zone had been dry the whole time.
// Finding 4a: the discard happens at the controller boundary, so pin it there. A plan that
// could not run is consumed, not parked -- which is what stops it firing once the season
// changes. The zone's soil is above its threshold, so only a parked plan could water it.
// Finding 4b: every Plan is clamped by the seasonal run-time cap too, not only the pulse
// count. With the cap smaller than a standard profile needs, the cycle ends there.
// --- Timetable (mirrors features/timetable.feature) ---

namespace {
Timetable windowFor(Season season, uint32_t seq, std::initializer_list<TimetableEntry> list) {
  Timetable t{};
  t.season = season;
  t.windowSeq = seq;
  uint8_t i = 0;
  for (const TimetableEntry& e : list) {
    if (i < kMaxTimetableEntries) t.entries[i] = e;
    i++;
  }
  t.count = i;
  return t;
}
}  // namespace

// Scenario: A live Timetable stands the device's own threshold down.
void test_a_live_timetable_stands_the_threshold_down() {
  FakeClock clock(true, 12, 7);

  // Without a Window, 40% in summer daylight is watered by the device's own threshold.
  FakeWateringZone own(40.0f);
  IWateringZone* ownZones[] = {&own};
  IrrigationController unattended(ownZones, 1, config::kSeasonal, clock);
  unattended.begin();
  unattended.tick(1000U);
  TEST_ASSERT_TRUE(own.pumpOn());

  // With a Window that waters nothing, it must not. Zero entries is an authored hold,
  // not a gap for the threshold loop to fill.
  FakeWateringZone held(40.0f);
  IWateringZone* heldZones[] = {&held};
  IrrigationController controlled(heldZones, 1, config::kSeasonal, clock);
  controlled.begin();
  TEST_ASSERT_TRUE(controlled.installTimetable(0, windowFor(Season::Summer, 100, {}), 0U));
  controlled.tick(1000U);
  TEST_ASSERT_FALSE(held.pumpOn());
}

// Scenario: A Timetable entry starts a cycle without any dryness.
void test_a_timetable_entry_starts_a_cycle_without_dryness() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(80.0f);  // far above every threshold
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  TEST_ASSERT_TRUE(
      controller.installTimetable(0, windowFor(Season::Summer, 100, {{0, Plan::TopUp, false}}), 0U));

  controller.tick(1000U);

  // An entry is an intent: no soil comparison and no watering window gate it, exactly as
  // a Plan was not gated before it.
  TEST_ASSERT_TRUE(zone.pumpOn());
}

// Scenario: Critical dryness still starts a cycle inside a live Timetable.
void test_critical_dryness_still_starts_a_cycle_inside_a_live_timetable() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(30.0f);  // at or below the 35% critical threshold
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  TEST_ASSERT_TRUE(controller.installTimetable(0, windowFor(Season::Summer, 100, {}), 0U));

  controller.tick(1000U);

  // Critical dryness is an Actuator limit, not a policy: a Window that waters nothing
  // cannot suppress it, or a held plant would sit in drought for four hours.
  TEST_ASSERT_TRUE(zone.pumpOn());
}

// Scenario: A live Timetable hands the trigger back when it expires.
void test_a_live_timetable_hands_the_trigger_back_at_expiry() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(40.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  TEST_ASSERT_TRUE(controller.installTimetable(0, windowFor(Season::Summer, 100, {}), 0U));
  controller.tick(1000U);
  TEST_ASSERT_FALSE(zone.pumpOn());

  controller.tick(kWindowMs);  // the Window has run its four hours

  TEST_ASSERT_TRUE(zone.pumpOn());
}

// Scenario: A Timetable whose declared season is dormant does not water.
void test_a_dormant_declared_season_waters_nothing_even_without_a_probe_gate() {
  FakeClock clock(true, 12, 7);  // the clock says summer
  FakeWateringZone zone(30.0f);  // even at the critical threshold
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  // The author declares the season it reasoned under, and dormancy is the machine's own
  // bound: it outranks both a Threshold cycle and the critical override.
  TEST_ASSERT_TRUE(
      controller.installTimetable(0, windowFor(Season::Winter, 100, {{0, Plan::Standard, false}}), 0U));

  controller.tick(1000U);

  TEST_ASSERT_FALSE(zone.pumpOn());
}

// Scenario: The controller reports the executor's outcome on its snapshot, so the
// sub-node can carry it on the StatusReport the main node publishes.
void test_controller_reports_the_timetable_outcome() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(80.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  TEST_ASSERT_TRUE(
      controller.installTimetable(0, windowFor(Season::Summer, 100, {{0, Plan::TopUp, false}}), 0U));

  // Before anything comes due there is no verdict, which is the value the publisher treats
  // as "stay silent".
  TEST_ASSERT_EQUAL_UINT32(0u, controller.snapshot(0).ttOutcomeWindowSeq);

  controller.tick(1000U);

  TEST_ASSERT_TRUE(zone.pumpOn());
  IrrigationController::StatusSnapshot snapshot = controller.snapshot(0);
  TEST_ASSERT_EQUAL_UINT32(100u, snapshot.ttOutcomeWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, snapshot.ttOutcomeIndex);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EntryRefusal::None), snapshot.ttOutcomeCode);
  TEST_ASSERT_EQUAL_UINT8(1, snapshot.ttRanCount);
  TEST_ASSERT_EQUAL_UINT8(0, snapshot.ttRefusedCount);
}

// Scenario: A night entry still starts its cycle, and the controller hands the started
// entry to the composition root exactly once, carrying the author's marker for the log.
void test_controller_hands_the_started_entry_once_with_its_marker() {
  FakeClock clock(true, 12, 7);  // the gate itself would refuse a night entry outside 06-21
  FakeWateringZone zone(80.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  TEST_ASSERT_TRUE(controller.installTimetable(
      0, windowFor(Season::Summer, 100, {{0, Plan::Standard, true}}), 0U));

  controller.tick(1000U);

  // The marker is reported, never gating: the entry started despite being marked night.
  TEST_ASSERT_TRUE(zone.pumpOn());
  IrrigationController::TimetableEntryNotice notice;
  TEST_ASSERT_TRUE(controller.consumeTimetableEntry(notice));
  TEST_ASSERT_EQUAL_UINT32(100u, notice.windowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, notice.index);
  TEST_ASSERT_EQUAL_UINT16(0, notice.offsetMinutes);
  TEST_ASSERT_EQUAL(Plan::Standard, notice.intent);
  TEST_ASSERT_TRUE(notice.night);
  // One-shot: the same entry is not reported on every following tick.
  controller.tick(2000U);
  TEST_ASSERT_FALSE(controller.consumeTimetableEntry(notice));
}

// Scenario: A refused entry is reported with the code that refused it, so the author learns
// why a Table's entry did not water.
void test_controller_reports_a_refused_entry_code() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(80.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();
  TEST_ASSERT_TRUE(controller.installTimetable(
      0, windowFor(Season::Summer, 100, {{0, Plan::Standard, false}}), 0U));
  controller.setLocalForceWatering(0, true, 900U);  // a manual force owns the zone

  controller.tick(1000U);

  IrrigationController::StatusSnapshot snapshot = controller.snapshot(0);
  TEST_ASSERT_EQUAL_UINT32(100u, snapshot.ttOutcomeWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EntryRefusal::Force), snapshot.ttOutcomeCode);
  TEST_ASSERT_EQUAL_UINT8(0, snapshot.ttRanCount);
  TEST_ASSERT_EQUAL_UINT8(1, snapshot.ttRefusedCount);
  // A refusal is a consumed entry, not a started one, so no start notice is filed.
  IrrigationController::TimetableEntryNotice notice;
  TEST_ASSERT_FALSE(controller.consumeTimetableEntry(notice));
}

// Scenario: Routine watering waits for the morning
// Care quality, not economy: watering in the morning leaves the day's evaporation to dry the
// substrate back before the cool humid night that fungal infection and tuber rot live in.
void test_routine_watering_waits_for_the_morning() {
  FakeClock afternoon(true, 16, 7);
  FakeWateringZone zone(49.0f);  // under the summer trigger (50), but not deeply so
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, afternoon);
  controller.begin();

  for (uint32_t now = 1000U; now < 600000U; now += 500U) controller.tick(now);

  TEST_ASSERT_FALSE(zone.pumpOn());  // waits: the pot can hold until morning
}

// Scenario: A deeply dry pot does not wait for the morning
// Past the margin the pot is in the drought-stress case, and drought stress costs growth.
void test_a_deeply_dry_pot_is_watered_in_the_afternoon() {
  FakeClock afternoon(true, 16, 7);
  FakeWateringZone zone(40.0f);  // 10 points under the summer trigger: deeper than the margin
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, afternoon);
  controller.begin();

  for (uint32_t now = 1000U; now < 600000U && !zone.pumpOn(); now += 500U) controller.tick(now);

  TEST_ASSERT_TRUE(zone.pumpOn());
}

// Scenario: A nudge, not a soak, at the low edge of the band
// Same trigger, smaller dose: a cycle that runs two pulses where the seasonal profile allows
// ten, delivered by the profile the intent table already owns.
void test_a_nudge_at_the_edge_of_the_band_runs_two_pulses() {
  FakeClock clock(true, 8, 7);
  FakeWateringZone zone(45.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();

  // One full cycle first, so a watering is recent -- and confirmed: the probe rises during it,
  // which is what makes a nudge an option at all.
  uint32_t now = 1000U;
  bool running = false;
  for (; now < 900000U; now += 500U) {
    zone.setSoil(running ? 55.0f : 45.0f);
    controller.tick(now);
    if (zone.pumpOn()) running = true;
  }

  // Recover above the trigger, then let it fall back to the low edge of the band.
  for (; now < 15000000U; now += 500U) {
    zone.setSoil(60.0f);
    controller.tick(now);
  }

  int pulses = 0;
  bool wasOn = false;
  for (; now < 16000000U; now += 500U) {
    zone.setSoil(49.0f);
    controller.tick(now);
    const bool on = zone.pumpOn();
    if (on && !wasOn) pulses++;
    wasOn = on;
  }

  TEST_ASSERT_EQUAL_INT(2, pulses);
}

// Scenario: An unconfirmed probe does not get the benefit of the doubt about the wet cap
// The wet cap is read from the same probe that missed the last cycle, and saturation is the
// failure that kills the plant while an early stop is one it recovers from. The dose is what
// narrows -- not the trigger: a pot that reads dry still gets watered.
void test_an_unconfirmed_cycle_narrows_the_next_dose() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(45.0f);  // dry, and the probe never moves: the first cycle is weak
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();

  // Cycle 1: runs to the pulse cap, the probe never rises, so it is judged weak.
  uint32_t now = 1000U;
  for (; now < 900000U; now += 500U) controller.tick(now);
  TEST_ASSERT_FALSE(zone.pumpOn());

  // Hold it above the trigger until the minimum gap has passed: no cycle runs, so the weak
  // streak stays at one and the retry path (which also wants the soil still dry) never fires.
  for (now = 900000U; now < 15000000U; now += 500U) {
    zone.setSoil(60.0f);
    controller.tick(now);
  }
  TEST_ASSERT_FALSE(zone.pumpOn());

  // Now the probe does register water, but late: the pot reads 70 %, which is below the summer
  // wet cap (75) and above the narrowed one (65). The zone fires on dry soil -- the trigger is
  // untouched -- and must stop early instead of soaking up to the preset's ceiling.
  int pulses = 0;
  bool wasOn = false;
  bool started = false;
  for (; now < 16000000U; now += 500U) {
    zone.setSoil(started ? 70.0f : 45.0f);
    controller.tick(now);
    const bool on = zone.pumpOn();
    if (on && !wasOn) pulses++;
    wasOn = on;
    if (on) started = true;
  }

  TEST_ASSERT_TRUE(started);   // it did water: the trigger is untouched
  TEST_ASSERT_TRUE(pulses > 0);
  TEST_ASSERT_TRUE(pulses < config::kSeasonal[1].pulse.maxPulses);  // but not a full soak
}

// Scenario: A cycle the probe never saw stops repeating itself
// A pot whose probe cannot see the water is disarmed by its own cycle: the soil never comes
// back above the trigger, so the zone waits instead of firing again when the minimum gap
// lapses. It is not never -- the same dry soil is retried after the fault window, which is how
// a run of weak cycles reaches the three that latch the visible fault.
void test_a_cycle_the_probe_never_saw_disarms_the_zone() {
  FakeClock clock(true, 12, 7);
  FakeWateringZone zone(45.0f);  // under the summer dry threshold (50) and staying there
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock);
  controller.begin();

  uint32_t now = 1000U;
  for (; now < 900000U; now += 500U) controller.tick(now);  // one cycle runs and ends

  TEST_ASSERT_FALSE(zone.pumpOn());

  int starts = 0;
  bool wasOn = false;
  for (; now < 900000U + 16000000U; now += 500U) {  // 4.5 h past the minimum gap
    controller.tick(now);
    const bool on = zone.pumpOn();
    if (on && !wasOn) starts++;
    wasOn = on;
  }

  TEST_ASSERT_EQUAL_INT(0, starts);

  // The pot recovers -- or the probe finally reads the water: the zone is armed again, and the
  // next genuine dryness starts a cycle instead of being refused by the arming rule.
  zone.setSoil(60.0f);
  for (; now < 900000U + 16000000U + 10000U; now += 500U) controller.tick(now);
  TEST_ASSERT_FALSE(zone.pumpOn());  // in band: armed, but nothing to water for

  zone.setSoil(45.0f);
  for (; now < 900000U + 16000000U + 11000U; now += 500U) controller.tick(now);

  TEST_ASSERT_TRUE(zone.pumpOn());
}

void test_leaf_install_receipt_does_not_rearm_actual_controller() {
  FakeClock clock(true, 12, 7); FakeWateringZone zone(80.0f);
  IWateringZone* zones[] = {&zone};
  IrrigationController controller(zones, 1, config::kSeasonal, clock); controller.begin();
  PlanInstallReceipt receipt;
  Timetable table = windowFor(Season::Summer, 321, {{0, Plan::TopUp, false}});
  auto install = [&](const Timetable& value) { return controller.installTimetable(0, value, 0); };
  TEST_ASSERT_TRUE(receipt.install(table, install));
  TEST_ASSERT_FALSE(zone.pumpOn()); // installation alone does not run an entry
  controller.tick(1000);
  TEST_ASSERT_TRUE(zone.pumpOn());
  TEST_ASSERT_TRUE(receipt.install(table, install));
  TEST_ASSERT_EQUAL(1, controller.snapshot(0).ttRanCount);
  table.entries[0].intent = Plan::DeepSoak;
  TEST_ASSERT_FALSE(receipt.install(table, install));
  TEST_ASSERT_EQUAL(1, controller.snapshot(0).ttRanCount);
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_leaf_install_receipt_does_not_rearm_actual_controller);
  RUN_TEST(test_a_live_timetable_stands_the_threshold_down);
  RUN_TEST(test_a_timetable_entry_starts_a_cycle_without_dryness);
  RUN_TEST(test_critical_dryness_still_starts_a_cycle_inside_a_live_timetable);
  RUN_TEST(test_a_live_timetable_hands_the_trigger_back_at_expiry);
  RUN_TEST(test_a_dormant_declared_season_waters_nothing_even_without_a_probe_gate);
  RUN_TEST(test_controller_reports_the_timetable_outcome);
  RUN_TEST(test_controller_hands_the_started_entry_once_with_its_marker);
  RUN_TEST(test_controller_reports_a_refused_entry_code);
  RUN_TEST(test_night_gate_status_is_independent_per_zone);
  RUN_TEST(test_closed_gate_reports_wait_for_the_modulated_band);
  RUN_TEST(test_invalid_clock_blocks_routine_and_allows_critical_dryness);
  RUN_TEST(test_winter_dormancy_suppresses_zero_soil_critical_override_after_clock_stales);
  RUN_TEST(test_clock_staleness_aborts_routine_cycle_and_fresh_time_restores_day_gate);
  RUN_TEST(test_snapshot_groups_zone_observability);
  RUN_TEST(test_force_ownership_requires_both_sources_to_release);
  RUN_TEST(test_winter_dormancy_rejects_local_force_watering);
  RUN_TEST(test_winter_dormancy_rejects_remote_force_watering);
  RUN_TEST(test_winter_transition_clears_active_force_owners_and_pump);
  RUN_TEST(test_force_ownership_is_local_to_its_zone);
  RUN_TEST(test_a_plan_is_clamped_by_the_seasonal_pulse_cap);
  RUN_TEST(test_a_cycle_the_probe_never_saw_disarms_the_zone);
  RUN_TEST(test_an_unconfirmed_cycle_narrows_the_next_dose);
  RUN_TEST(test_routine_watering_waits_for_the_morning);
  RUN_TEST(test_a_deeply_dry_pot_is_watered_in_the_afternoon);
  RUN_TEST(test_a_nudge_at_the_edge_of_the_band_runs_two_pulses);
  return UNITY_END();
}
