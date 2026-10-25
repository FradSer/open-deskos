#include <unity.h>

#include <domain/irrigation_policy.h>
#include <domain/vpd.h>

using namespace hydra;

// Mirrors features/irrigation.feature. The policy is pure, so these run on the
// host with no hardware: pio test -e native.

namespace {
constexpr uint32_t kNow = 2000000U;  // arbitrary millis timestamp

IrrigationConfig cfg() {
  return IrrigationConfig{
      35.0f,        // dryPercent
      80.0f,        // wetPercent
      20.0f,        // criticalPercent
      75000U,       // maxRunMs
      14400000U,    // minIntervalMs (4h)
      {5000U, 40000U, 12},  // pulse: on, off, max
      false,        // disabled
  };
}

IrrigationConfig winterCfg() {
  return IrrigationConfig{
      35.0f,        // dryPercent
      80.0f,        // wetPercent
      0.0f,         // criticalPercent: zero soil is winter's only nominal critical value
      75000U,       // maxRunMs
      14400000U,    // minIntervalMs
      {5000U, 40000U, 12},
      true,  // disabled (dormancy)
  };
}

IrrigationConfig autumnCfg() {
  return IrrigationConfig{
      30.0f,        // dryPercent (lower than summer)
      70.0f,        // wetPercent (lower than summer)
      20.0f,        // criticalPercent
      50000U,       // maxRunMs
      21600000U,    // minIntervalMs (6h)
      {5000U, 40000U, 8},  // pulse: on, off, max
      false,
  };
}

ZoneRuntime idle() {
  return ZoneRuntime{PumpPhase::Idle, 0, 0, 0, 0, 0, false, 0.0f};
}

ZoneRuntime pulseOn(uint32_t startedAt, uint32_t phaseAt, int count, uint32_t accOn) {
  return ZoneRuntime{PumpPhase::PulseOn, startedAt, phaseAt, 0, count, accOn, false, 30.0f};
}

ZoneRuntime pulseOff(uint32_t startedAt, uint32_t phaseAt, int count, uint32_t accOn) {
  return ZoneRuntime{PumpPhase::PulseOff, startedAt, phaseAt, 0, count, accOn, false, 30.0f};
}
}  // namespace

void setUp() {}
void tearDown() {}

// Scenario: Dry soil starts a pulse cycle
void test_dry_idle_starts() {
  TEST_ASSERT_TRUE(decidePump(cfg(), idle(), 30.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::PulseOn);
}

// Idle but already moist enough -> leave it alone
void test_moist_idle_stays_off() {
  TEST_ASSERT_TRUE(decidePump(cfg(), idle(), 50.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Scenario: Pulse ON phase ends after configured ON duration
void test_pulse_on_ends() {
  auto rt = pulseOn(kNow - 10000, kNow - 5000, 1, 0);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 40.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::PulseOff);
}

// Pulse ON still running, not yet time to switch
void test_pulse_on_continues() {
  auto rt = pulseOn(kNow - 10000, kNow - 3000, 1, 0);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 40.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Scenario: Soak phase transitions to next pulse
void test_soak_transitions() {
  auto rt = pulseOff(kNow - 60000, kNow - 40000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 45.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::PulseOn);
}

// Soak phase not yet done
void test_soak_continues() {
  auto rt = pulseOff(kNow - 60000, kNow - 20000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 45.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Scenario: Cycle completes when soil reaches wet target during soak
void test_soak_reaches_wet_ends() {
  auto rt = pulseOff(kNow - 60000, kNow - 20000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 82.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// Scenario: Cycle completes after delivering all pulses
void test_all_pulses_done_ends() {
  auto rt = pulseOff(kNow - 600000, kNow - 20000, 12, 60000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 50.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// Scenario: Accumulated ON time safety cap stops the cycle
void test_safety_cap_stops() {
  auto rt = pulseOn(kNow - 100000, kNow - 3000, 10, 72000);  // 72s accumulated + 3s = 75s
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 50.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// Scenario: Invalid soil reading during pulse ON ends the cycle
void test_invalid_pulse_on_ends() {
  auto rt = pulseOn(kNow - 10000, kNow - 3000, 2, 5000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 40.0f, false, kNow, true, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// Scenario: Invalid soil reading during soak phase ends the cycle
void test_invalid_soak_ends() {
  auto rt = pulseOff(kNow - 60000, kNow - 20000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 45.0f, false, kNow, true, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// Scenario: Minimum interval blocks a new cycle
void test_min_interval_blocks() {
  ZoneRuntime rt{PumpPhase::Idle, 0, 0, kNow - 7200000U, 0, 0, true, 0.0f};  // 2h ago
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 30.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Scenario: Minimum interval elapsed allows a new cycle
void test_after_interval_starts() {
  ZoneRuntime rt{PumpPhase::Idle, 0, 0, kNow - 14400000U, 0, 0, true, 0.0f};  // 4h ago
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 30.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::PulseOn);
}

// Scenario: A zone disarmed by its own cycle does not repeat it
// The pot's probe never saw the last cycle's water, so the soil is still under the trigger.
// Firing again on the timer only adds water the pot is not taking up -- which is how one field
// zone came to run four cycles in a day with the probe moving +0.5, 0.0 and -0.2 %.
void test_a_disarmed_zone_does_not_re_fire() {
  ZoneRuntime rt{PumpPhase::Idle, 0, 0, kNow - 14400000U, 0, 0, true, 0.0f};
  rt.armed = false;

  TEST_ASSERT_EQUAL(static_cast<int>(PumpAction::None),
                    static_cast<int>(decidePump(cfg(), rt, 30.0f, true, kNow, true, false,
                                                defaultEnvContext())));
}

// Scenario: Critical dryness is never disarmed
// A pot that far down is not left waiting on a recovery that may be the very thing that broke.
void test_critical_dryness_fires_even_when_disarmed() {
  ZoneRuntime rt{PumpPhase::Idle, 0, 0, kNow - 14400000U, 0, 0, true, 0.0f};
  rt.armed = false;

  TEST_ASSERT_EQUAL(static_cast<int>(PumpAction::PulseOn),
                    static_cast<int>(decidePump(cfg(), rt, 20.0f, true, kNow, true, false,
                                                defaultEnvContext())));
}

// Scenario: A recovered zone is armed again by the controller
// Arming is the controller's, because it owns the readings; the policy only honours the flag.
void test_an_armed_zone_starts_again() {
  ZoneRuntime rt{PumpPhase::Idle, 0, 0, kNow - 14400000U, 0, 0, true, 0.0f};
  rt.armed = true;

  TEST_ASSERT_EQUAL(static_cast<int>(PumpAction::PulseOn),
                    static_cast<int>(decidePump(cfg(), rt, 30.0f, true, kNow, true, false,
                                                defaultEnvContext())));
}

// Scenario: Watering is blocked when not allowed
void test_blocked_idle_stays_off() {
  TEST_ASSERT_TRUE(decidePump(cfg(), idle(), 25.0f, true, kNow, false, false, defaultEnvContext()) == PumpAction::None);
}

// A normal transition to nighttime does not interrupt an active cycle.
void test_blocked_pulse_on_continues() {
  auto rt = pulseOn(kNow - 10000, kNow - 3000, 3, 10000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 40.0f, true, kNow, false, false,
                              defaultEnvContext()) == PumpAction::None);
}

void test_blocked_soak_continues() {
  auto rt = pulseOff(kNow - 60000, kNow - 20000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 45.0f, true, kNow, false, false,
                              defaultEnvContext()) == PumpAction::None);
}

// A stale main clock is stricter than an ordinary nighttime transition: it
// aborts a noncritical running cycle, including a soak before it can re-pulse.
void test_stale_clock_aborts_noncritical_pulse_on() {
  auto rt = pulseOn(kNow - 10000, kNow - 3000, 3, 10000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 40.0f, true, kNow, false, true,
                              defaultEnvContext()) == PumpAction::AbortCycle);
}

void test_stale_clock_aborts_noncritical_soak_before_next_pulse() {
  auto rt = pulseOff(kNow - 60000, kNow - 40000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 45.0f, true, kNow, false, true,
                              defaultEnvContext()) == PumpAction::AbortCycle);
}

void test_stale_clock_keeps_critical_active_cycle_eligible() {
  auto on = pulseOn(kNow - 10000, kNow - 3000, 3, 10000);
  TEST_ASSERT_TRUE(decidePump(cfg(), on, 15.0f, true, kNow, false, true,
                              defaultEnvContext()) == PumpAction::None);
  auto soak = pulseOff(kNow - 60000, kNow - 40000, 3, 15000);
  TEST_ASSERT_TRUE(decidePump(cfg(), soak, 15.0f, true, kNow, false, true,
                              defaultEnvContext()) == PumpAction::PulseOn);
}

// Invalid reading still ends cycle even when time-blocked
void test_blocked_invalid_still_ends() {
  auto rt = pulseOn(kNow - 10000, kNow - 3000, 3, 10000);
  TEST_ASSERT_TRUE(decidePump(cfg(), rt, 40.0f, false, kNow, false, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// Invalid reading still stays off when idle and time-blocked
void test_blocked_invalid_idle_stays_off() {
  TEST_ASSERT_TRUE(decidePump(cfg(), idle(), 10.0f, false, kNow, false, false, defaultEnvContext()) == PumpAction::None);
}

// --- Seasonal tests ---

// Scenario: Winter dormancy disables watering
void test_winter_dormancy_blocks() {
  TEST_ASSERT_TRUE(decidePump(winterCfg(), idle(), 10.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Winter dormancy blocks even when time-allowed and critical dryness
void test_winter_dormancy_blocks_critical() {
  TEST_ASSERT_TRUE(decidePump(winterCfg(), idle(), 5.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Dormancy is checked before every phase-specific critical and stale-clock rule.
void test_winter_disabled_blocks_idle_at_zero_soil() {
  TEST_ASSERT_EQUAL(PumpAction::None,
                    decidePump(winterCfg(), idle(), 0.0f, true, kNow, true, true,
                               defaultEnvContext()));
}

void test_winter_disabled_ends_active_pulse_on_at_zero_soil_when_clock_is_stale() {
  auto rt = pulseOn(kNow - 10000U, kNow - 3000U, 3, 10000U);
  TEST_ASSERT_EQUAL(PumpAction::EndCycle,
                    decidePump(winterCfg(), rt, 0.0f, true, kNow, false, true,
                               defaultEnvContext()));
}

void test_winter_disabled_ends_active_soak_at_zero_soil_when_clock_is_stale() {
  auto rt = pulseOff(kNow - 60000U, kNow - 40000U, 3, 15000U);
  TEST_ASSERT_EQUAL(PumpAction::EndCycle,
                    decidePump(winterCfg(), rt, 0.0f, true, kNow, false, true,
                               defaultEnvContext()));
}

// seasonFromMonth mapping (Shenzhen subtropical)
void test_season_from_month() {
  TEST_ASSERT_TRUE(seasonFromMonth(1) == Season::Winter);
  TEST_ASSERT_TRUE(seasonFromMonth(2) == Season::Winter);
  TEST_ASSERT_TRUE(seasonFromMonth(3) == Season::Spring);
  TEST_ASSERT_TRUE(seasonFromMonth(4) == Season::Spring);
  TEST_ASSERT_TRUE(seasonFromMonth(5) == Season::Summer);
  TEST_ASSERT_TRUE(seasonFromMonth(6) == Season::Summer);
  TEST_ASSERT_TRUE(seasonFromMonth(7) == Season::Summer);
  TEST_ASSERT_TRUE(seasonFromMonth(8) == Season::Summer);
  TEST_ASSERT_TRUE(seasonFromMonth(9) == Season::Summer);
  TEST_ASSERT_TRUE(seasonFromMonth(10) == Season::Summer);
  TEST_ASSERT_TRUE(seasonFromMonth(11) == Season::Autumn);
  TEST_ASSERT_TRUE(seasonFromMonth(12) == Season::Autumn);
}

// seasonName returns correct strings
void test_season_name() {
  TEST_ASSERT_EQUAL_STRING("SPRING", seasonName(Season::Spring));
  TEST_ASSERT_EQUAL_STRING("SUMMER", seasonName(Season::Summer));
  TEST_ASSERT_EQUAL_STRING("AUTUMN", seasonName(Season::Autumn));
  TEST_ASSERT_EQUAL_STRING("WINTER", seasonName(Season::Winter));
}

// --- Time-of-day gate (isWithinWateringWindow) ---
// Mirrors features/irrigation.feature: morning/evening allow, night blocks,
// critical override is the caller's job (not this function). An invalid clock
// (main node offline / no synced time) is treated as night -- NOT always-allow,
// because watering blind at night risks tuber rot on a caladium.
namespace {
class FakeClock : public IClock {
 public:
  FakeClock(bool valid, int hour) : valid_(valid), hour_(hour) {}
  int currentHour() const override { return valid_ ? hour_ : -1; }
  int currentMonth() const override { return valid_ ? 7 : -1; }
  bool isValid() const override { return valid_; }

 private:
  bool valid_;
  int hour_;
};
}  // namespace

void test_window_morning_allows() {
  FakeClock c(true, 7);
  TEST_ASSERT_TRUE(isWithinWateringWindow(c, 6, 21));
}

void test_window_evening_allows() {
  FakeClock c(true, 17);
  TEST_ASSERT_TRUE(isWithinWateringWindow(c, 6, 21));
}

void test_window_night_blocks() {
  FakeClock c(true, 22);
  TEST_ASSERT_FALSE(isWithinWateringWindow(c, 6, 21));
}

void test_window_start_boundary_includes() {
  FakeClock c(true, 6);
  TEST_ASSERT_TRUE(isWithinWateringWindow(c, 6, 21));
}

void test_window_end_boundary_excludes() {
  FakeClock c(true, 21);
  TEST_ASSERT_FALSE(isWithinWateringWindow(c, 6, 21));
}

void test_window_invalid_clock_blocks() {
  FakeClock c(false, 0);
  TEST_ASSERT_FALSE(isWithinWateringWindow(c, 6, 21));
}

void test_window_invalid_clock_blocks_even_midday() {
  // The low-level window helper remains conservative for an unknown clock.
  FakeClock c(false, 12);
  TEST_ASSERT_FALSE(isWithinWateringWindow(c, 6, 21));
}

void test_autonomous_gate_blocks_invalid_clock() {
  FakeClock c(false, 12);
  TEST_ASSERT_FALSE(isAutonomousWateringAllowed(c, 6, 21));
}

void test_autonomous_gate_keeps_valid_night_blocked() {
  FakeClock c(true, 22);
  TEST_ASSERT_FALSE(isAutonomousWateringAllowed(c, 6, 21));
}

// --- Seasonal default on an invalid clock (seasonFromClock) ---
// A clockless sub-node defaults to Summer (NOT Winter): the time-of-day gate
// already blocks routine watering on an invalid clock, and Summer keeps
// disabled=false + the real criticalPercent so the critical-dry emergency
// override stays alive. Winter would set disabled=true and short-circuit
// decidePump before the critical override.
void test_season_invalid_clock_defaults_summer() {
  FakeClock c(false, 0);
  TEST_ASSERT_EQUAL(Season::Summer, seasonFromClock(c));
}

void test_season_valid_july_is_summer() {
  FakeClock c(true, 9);
  // FakeClock currentMonth() returns 7 (July) when valid -> Summer
  TEST_ASSERT_EQUAL(Season::Summer, seasonFromClock(c));
}

void test_season_invalid_clock_overrides_stored_hour() {
  // Even if the cached hour were a summer month, an invalid clock falls back to
  // the Summer default (not the cached month).
  FakeClock c(false, 7);
  TEST_ASSERT_EQUAL(Season::Summer, seasonFromClock(c));
}

// Scenario: Autumn config uses different thresholds
void test_autumn_dry_starts_at_lower_threshold() {
  auto ac = autumnCfg();
  // At 28% (below autumn dry of 30%), should start
  TEST_ASSERT_TRUE(decidePump(ac, idle(), 28.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::PulseOn);
  // At 32% (above autumn dry of 30%), should not start
  TEST_ASSERT_TRUE(decidePump(ac, idle(), 32.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::None);
}

// Scenario: Autumn wet target is lower
void test_autumn_wet_ends_earlier() {
  auto ac = autumnCfg();
  auto rt = pulseOff(kNow - 60000, kNow - 20000, 3, 15000);
  // At 72% (above autumn wet of 70%), should end
  TEST_ASSERT_TRUE(decidePump(ac, rt, 72.0f, true, kNow, true, false, defaultEnvContext()) == PumpAction::EndCycle);
}

// --- Efficacy / fault detection (evaluateCycle) ---

namespace {
FaultConfig faultCfg() {
  return FaultConfig{3.0f, 3};  // minDeltaPercent, maxConsecutiveFailures
}
}  // namespace

// Scenario: A single weak cycle does not fault (judged as Failed; controller
// only faults after the streak reaches the cap).
void test_weak_cycle_is_failed() {
  // soil peaked 2% above start (< 3% delta), valid sensor, pulses ran
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 32.0f, true, 12) == CycleEfficacy::Failed);
}

// Scenario: A good cycle resets the weak-cycle streak.
void test_good_cycle_is_ok() {
  // soil peaked 10% above start (>= 3% delta)
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 40.0f, true, 12) == CycleEfficacy::Ok);
}

// Delta exactly at threshold counts as Ok (failure is strictly less-than).
void test_delta_at_threshold_is_ok() {
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 33.0f, true, 5) == CycleEfficacy::Ok);
}

// Scenario: An unjudgeable cycle - invalid sensor.
void test_invalid_sensor_is_unjudged() {
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 30.0f, false, 12) == CycleEfficacy::Unjudged);
}

// Scenario: An unjudgeable cycle - no pulses delivered.
void test_zero_pulses_is_unjudged() {
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 30.0f, true, 0) == CycleEfficacy::Unjudged);
}

// Regression: the EndCycle reading lags percolation/EMA and reads as a trough,
// but water did reach the probe mid-cycle (peak 36). Peak-based judgment calls
// this Ok; the old EndCycle-instant logic would have false-faulted it.
void test_peak_survives_endcycle_trough() {
  // soilStart=30, EndCycle trough=32 (old: Failed), cycle peak=36 (>= 3 delta)
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 36.0f, true, 15) == CycleEfficacy::Ok);
}

// A truly dead pump/probe produces no peak above start -> still Failed.
void test_no_peak_is_failed() {
  TEST_ASSERT_TRUE(evaluateCycle(faultCfg(), 30.0f, 31.0f, true, 15) == CycleEfficacy::Failed);
}

// --- VPD calculation tests ---

// VPD at 25°C, 60% RH should be ~1.26 kPa (typical indoor)
void test_vpd_typical_indoor() {
  float vpd = calculateVPD(25.0f, 60.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 1.26f, vpd);
}

// VPD at 30°C, 80% RH should be ~0.85 kPa (humid summer)
void test_vpd_humid_summer() {
  float vpd = calculateVPD(30.0f, 80.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 0.85f, vpd);
}

// VPD at 20°C, 30% RH should be ~1.62 kPa (dry winter)
void test_vpd_dry_winter() {
  float vpd = calculateVPD(20.0f, 30.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 1.62f, vpd);
}

// VPD at 100% RH should be 0 (saturated air)
void test_vpd_saturated() {
  float vpd = calculateVPD(25.0f, 100.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, vpd);
}

// VPD above 100% RH (condensing) is clamped to 0, never negative.
void test_vpd_supersaturated_clamped() {
  float vpd = calculateVPD(25.0f, 105.0f);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, vpd);
  TEST_ASSERT_TRUE(vpd >= 0.0f);
}

// --- EnvContext modulation tests ---

// High VPD (>1.5 kPa) raises dryPercent by 5%
void test_high_vpd_raises_dry() {
  EnvContext env{1.8f, 5000.0f, 0.0f, true, false};  // high VPD, wire fresh
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 40.0f, adjusted);
}

// Low VPD (<0.5 kPa) lowers dryPercent by 3%
// Low VPD means little evaporation, so the plant's water is used more slowly -- but it is not a
// statement about how dry the substrate is, and it may not push the trigger below the band's own
// edge. The floor is what makes the modulation one-directional: our sensors may ask for water
// EARLIER than the plant's edge, never later.
void test_low_vpd_does_not_lower_the_trigger_below_the_band_edge() {
  EnvContext env{0.3f, 5000.0f, 0.0f, true, false};  // low VPD, wire fresh
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// Dim light means less transpiration, same argument: the edge is the floor.
void test_low_lux_does_not_lower_the_trigger_below_the_band_edge() {
  EnvContext env{1.0f, 500.0f, 0.0f, true, false};  // dim light, wire fresh
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// The floor is the edge itself, not a cap on the raise: a hot dry afternoon still waters sooner.
void test_a_hot_afternoon_still_raises_above_the_edge() {
  EnvContext env{2.2f, 20000.0f, -0.35f, true, true};  // high VPD + drying fast, bright
  float adjusted = modulateDryPercent(50.0f, env);
  TEST_ASSERT_TRUE(adjusted > 50.0f);
}

// Low lux (<1000) lowers dryPercent by 5% (night/dim)
void test_low_lux_leaves_the_trigger_at_the_edge() {
  EnvContext env{1.0f, 500.0f, 0.0f, true, false};  // dim light, wire fresh
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}
// Invalid lux (the main node stamps -1 when the BH1750 is dead/absent) must NOT be
// read as darkness: the lux>=0 guard suppresses the dim-light adjustment so a missing
// light sensor never biases the fleet toward under-watering.
void test_invalid_lux_no_modulation() {
  EnvContext env{1.0f, -1.0f, 0.0f, true, false};  // lux invalid sentinel, wire fresh
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// Fast drying (<-5%/hr) raises dryPercent by 3% -- with the wire env INVALID,
// proving the local drying signal modulates when the main node is down.
void test_fast_drying_raises_dry() {
  EnvContext env{1.0f, 5000.0f, -8.0f, false, true};  // wire stale, drying valid
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 38.0f, adjusted);
}

// Autonomy: wire env stale suppresses VPD/lux even at extreme values, but the
// local drying signal still applies. High VPD (would be +5) is ignored; drying
// (+3) is not -> 38, not 43. This is the guarantee the validity split protects.
void test_stale_wire_suppresses_vpd_keeps_drying() {
  EnvContext env{1.8f, 200.0f, -8.0f, false, true};  // high VPD + dim, but stale
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 38.0f, adjusted);
}

// No env data at all (both halves invalid) returns base dryPercent unchanged
void test_no_env_no_modulation() {
  EnvContext env = defaultEnvContext();
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// High VPD + low lux: modulation combines (5% + -5% = 0%)
void test_combined_modulation() {
  EnvContext env{1.8f, 500.0f, 0.0f, true, false};  // high VPD + dim, wire fresh
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// VPD exactly on the high threshold (1.5) is inside the deadband: strict `>` means
// no adjustment. lux 5000 is bright, so nothing moves.
void test_vpd_high_boundary_no_change() {
  EnvContext env{1.5f, 5000.0f, 0.0f, true, false};
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// VPD exactly on the low threshold (0.5) is inside the deadband: strict `<` means
// no adjustment.
void test_vpd_low_boundary_no_change() {
  EnvContext env{0.5f, 5000.0f, 0.0f, true, false};
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// Drying rate exactly on the noise floor does not trigger: strict `<`.
void test_dry_rate_boundary_no_change() {
  EnvContext env{1.0f, 5000.0f, env_mod::kDryRateFloor, false, true};
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f, adjusted);
}

// The term is PROPORTIONAL, because a pot is never drying at the -5 %/hr the old step waited
// for: this fleet's pots dry at 0.2-0.4 %/hr, where that step contributed exactly nothing and
// the only thing moving the threshold was the VPD step that flaps across 1.5 kPa.
void test_a_real_drying_rate_raises_the_threshold_proportionally() {
  EnvContext slow{1.0f, 5000.0f, -0.27f, false, true};  // measured on the fleet (node1)
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 36.2f, modulateDryPercent(35.0f, slow));
  EnvContext faster{1.0f, 5000.0f, -0.35f, false, true};
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 37.0f, modulateDryPercent(35.0f, faster));
}

// One noisy slope cannot move the threshold far: the raise is capped.
void test_a_steep_drying_rate_is_capped() {
  EnvContext env{1.0f, 5000.0f, -9.0f, false, true};
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 35.0f + env_mod::kDryRateDeltaMax,
                           modulateDryPercent(35.0f, env));
}

// The wire VPD and the local drying-rate adjustments stack: high VPD (+5) AND fast
// drying (+3) on a bright day (no lux change) = base + 8.
void test_vpd_and_drying_stack() {
  EnvContext env{1.8f, 5000.0f, -8.0f, true, true};  // high VPD + fast drying, both valid
  float adjusted = modulateDryPercent(35.0f, env);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 43.0f, adjusted);
}

// decidePump with high VPD: soil at 38% (above base dry 35%), should still start
void test_high_vpd_triggers_earlier() {
  EnvContext env{1.8f, 5000.0f, 0.0f, true, false};  // high VPD, wire fresh
  // Soil 38% > base 35%, but with +5% modulation -> effective dry = 40%
  TEST_ASSERT_TRUE(decidePump(cfg(), idle(), 38.0f, true, kNow, true, false, env) == PumpAction::PulseOn);
}

// decidePump with low VPD: soil at 33% (below base dry 35%), should not start
// Low VPD no longer delays watering below the edge. It used to lower the trigger to 32 while the
// band's edge stayed 35, so a pot at 33 % -- already under the plant's edge, and under the
// critical threshold as well -- satisfied neither the trigger nor, as it happened, the author.
void test_low_vpd_does_not_delay_watering_below_the_edge() {
  EnvContext env{0.3f, 5000.0f, 0.0f, true, false};  // low VPD, wire fresh
  TEST_ASSERT_TRUE(decidePump(cfg(), idle(), 33.0f, true, kNow, true, false, env) == PumpAction::PulseOn);
}

// --- Supervised watering (mirrors features/supervised_watering.feature) ---

// Scenario: A standard plan starts a cycle with no soil dryness and no watering window.
// Scenarios: refused by dormancy, by an unreadable probe, and while a cycle runs.
// Dormancy and probe readability are the machine's own bounds (ADR-0004), so no
// Plan in any Mode can open them.
// Scenario: A Plan honours the inter-cycle gap, so one intent and its replays
// cannot dose back to back (ADR-0002: bounds enforced twice).
// Scenarios: Hold and Release deliver no water at all, in any state.
// Scenario: The plan intent is named on the wire.
void test_plan_names_are_the_wire_spelling() {
  TEST_ASSERT_EQUAL_STRING("autonomous", planName(Plan::Autonomous));
  TEST_ASSERT_EQUAL_STRING("hold", planName(Plan::Hold));
  TEST_ASSERT_EQUAL_STRING("top_up", planName(Plan::TopUp));
  TEST_ASSERT_EQUAL_STRING("standard", planName(Plan::Standard));
  TEST_ASSERT_EQUAL_STRING("deep_soak", planName(Plan::DeepSoak));
}

// --- Supervision state -------------------------------------------------------

// A zone nobody has directed is Autonomous: the feature is inert until a zone is switched.
// A hold keeps the zone Supervised, which is what stands its own trigger down.
// A Release hands the trigger back at once, whatever the heartbeat would have allowed.
// The heartbeat boundary: still Supervised at the timeout minus one, lapsed at the value.
// The stall boundary: soil below the threshold with no watering Directive accepted for the
// stall period takes the trigger back. A live Supervisor holding forever is
// indistinguishable, to the plant, from a dead one.
// A watering Directive accepted inside the stall period resets it: the Supervisor has not
// been starving the zone, whatever the soil has been doing since.
// Soil that dried out recently is not starvation, however long the Supervisor has held.
// Soil that has risen above the threshold stops the stall clock, so the period has to be
// unbroken to count.
// --- The intent-to-pulses table ---------------------------------------------

// The profile one Plan asks for, clamped by the preset: asserted at the request, one above
// it, and below it. The run-time cap needs no clause here because the pulse engine enforces
// it on every cycle.
void test_plan_profiles_clamp_to_the_seasonal_preset() {
  IrrigationConfig narrow = cfg();
  narrow.pulse.maxPulses = 2;
  TEST_ASSERT_EQUAL_INT(2, planProfile(Plan::TopUp, narrow).maxPulses);

  IrrigationConfig roomy = cfg();
  roomy.pulse.maxPulses = 3;
  TEST_ASSERT_EQUAL_INT(2, planProfile(Plan::TopUp, roomy).maxPulses);

  IrrigationConfig tight = cfg();
  tight.pulse.maxPulses = 1;
  TEST_ASSERT_EQUAL_INT(1, planProfile(Plan::TopUp, tight).maxPulses);
}

// A deep soak keeps the seasonal count and doubles only the soak; a standard plan is the
// seasonal profile untouched; an autonomous cycle is the seasonal profile too.
void test_only_a_deep_soak_changes_the_soak_and_only_a_top_up_the_count() {
  IrrigationConfig base = cfg();
  const PlanProfile seasonal{base.pulse.maxPulses, base.pulse.pulseOffMs};

  TEST_ASSERT_EQUAL_INT(seasonal.maxPulses, planProfile(Plan::Standard, base).maxPulses);
  TEST_ASSERT_EQUAL_UINT32(seasonal.soakMs, planProfile(Plan::Standard, base).soakMs);
  TEST_ASSERT_EQUAL_INT(seasonal.maxPulses, planProfile(Plan::Autonomous, base).maxPulses);
  TEST_ASSERT_EQUAL_UINT32(seasonal.soakMs, planProfile(Plan::Autonomous, base).soakMs);

  TEST_ASSERT_EQUAL_INT(seasonal.maxPulses, planProfile(Plan::DeepSoak, base).maxPulses);
  TEST_ASSERT_EQUAL_UINT32(seasonal.soakMs * 2, planProfile(Plan::DeepSoak, base).soakMs);
}

// A runtime with no profile of its own -- an autonomous cycle, or a fixture -- runs the
// seasonal preset. Zero is the sentinel, not a plan's value, so nothing that predates this
// table changes behaviour.
void test_a_runtime_without_a_profile_runs_the_seasonal_preset() {
  IrrigationConfig base = cfg();
  ZoneRuntime rt{};
  TEST_ASSERT_EQUAL_INT(base.pulse.maxPulses, cycleMaxPulses(base, rt));
  TEST_ASSERT_EQUAL_UINT32(base.pulse.pulseOffMs, cycleSoakMs(base, rt));
}

// Scenario: The device's own dose follows the plant's preference for a narrow band
// The trigger is left alone -- waiting for the pot to fall further IS the wide swing the plant
// guidance warns against -- and the dose carries the difference: a nudge at the low edge of the
// band, a soak once the pot is genuinely dry or has not been watered in a day.
void test_the_autonomous_dose_is_a_nudge_at_the_edge_of_the_band() {
  const float dry = 50.0f;
  const float band = 5.0f;

  // At the trigger, confirmed absorption, watered within the day: a top-up.
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::TopUp),
                    static_cast<int>(autonomousPlan(50.0f, dry, true, true, band)));
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::TopUp),
                    static_cast<int>(autonomousPlan(46.0f, dry, true, true, band)));

  // Further down than the band, the substrate has really dried: a full soak, because a small
  // dose wets only the surface and channels past the root ball.
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::Standard),
                    static_cast<int>(autonomousPlan(44.0f, dry, true, true, band)));

  // An unconfirmed probe gets no nudge: nothing has shown that a small dose registers here.
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::Standard),
                    static_cast<int>(autonomousPlan(49.0f, dry, false, true, band)));

  // Not watered within the day: whatever the reading, this is a pot that has gone a long time
  // without water and needs the full profile.
  TEST_ASSERT_EQUAL(static_cast<int>(Plan::Standard),
                    static_cast<int>(autonomousPlan(49.0f, dry, true, false, band)));
}

// Scenario: Routine watering waits for the morning
// A morning watering leaves the day's evaporation to dry the substrate back before the cool
// humid night that fungal infection and tuber rot live in.
void test_routine_watering_is_the_morning_half_of_the_gate() {
  TEST_ASSERT_TRUE(isRoutineWateringHour(6, 14));
  TEST_ASSERT_TRUE(isRoutineWateringHour(13, 14));
  TEST_ASSERT_FALSE(isRoutineWateringHour(14, 14));
  TEST_ASSERT_FALSE(isRoutineWateringHour(20, 14));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_dry_idle_starts);
  RUN_TEST(test_moist_idle_stays_off);
  RUN_TEST(test_pulse_on_ends);
  RUN_TEST(test_pulse_on_continues);
  RUN_TEST(test_soak_transitions);
  RUN_TEST(test_soak_continues);
  RUN_TEST(test_soak_reaches_wet_ends);
  RUN_TEST(test_all_pulses_done_ends);
  RUN_TEST(test_safety_cap_stops);
  RUN_TEST(test_invalid_pulse_on_ends);
  RUN_TEST(test_invalid_soak_ends);
  RUN_TEST(test_min_interval_blocks);
  RUN_TEST(test_after_interval_starts);
  RUN_TEST(test_a_disarmed_zone_does_not_re_fire);
  RUN_TEST(test_critical_dryness_fires_even_when_disarmed);
  RUN_TEST(test_an_armed_zone_starts_again);
  RUN_TEST(test_the_autonomous_dose_is_a_nudge_at_the_edge_of_the_band);
  RUN_TEST(test_routine_watering_is_the_morning_half_of_the_gate);
  RUN_TEST(test_blocked_idle_stays_off);
  RUN_TEST(test_blocked_pulse_on_continues);
  RUN_TEST(test_blocked_soak_continues);
  RUN_TEST(test_stale_clock_aborts_noncritical_pulse_on);
  RUN_TEST(test_stale_clock_aborts_noncritical_soak_before_next_pulse);
  RUN_TEST(test_stale_clock_keeps_critical_active_cycle_eligible);
  RUN_TEST(test_blocked_invalid_still_ends);
  RUN_TEST(test_blocked_invalid_idle_stays_off);
  RUN_TEST(test_winter_dormancy_blocks);
  RUN_TEST(test_winter_dormancy_blocks_critical);
  RUN_TEST(test_winter_disabled_blocks_idle_at_zero_soil);
  RUN_TEST(test_winter_disabled_ends_active_pulse_on_at_zero_soil_when_clock_is_stale);
  RUN_TEST(test_winter_disabled_ends_active_soak_at_zero_soil_when_clock_is_stale);
  RUN_TEST(test_season_from_month);
  RUN_TEST(test_season_name);
  RUN_TEST(test_window_morning_allows);
  RUN_TEST(test_window_evening_allows);
  RUN_TEST(test_window_night_blocks);
  RUN_TEST(test_window_start_boundary_includes);
  RUN_TEST(test_window_end_boundary_excludes);
  RUN_TEST(test_window_invalid_clock_blocks);
  RUN_TEST(test_window_invalid_clock_blocks_even_midday);
  RUN_TEST(test_autonomous_gate_blocks_invalid_clock);
  RUN_TEST(test_autonomous_gate_keeps_valid_night_blocked);
  RUN_TEST(test_season_invalid_clock_defaults_summer);
  RUN_TEST(test_season_valid_july_is_summer);
  RUN_TEST(test_season_invalid_clock_overrides_stored_hour);
  RUN_TEST(test_autumn_dry_starts_at_lower_threshold);
  RUN_TEST(test_autumn_wet_ends_earlier);
  RUN_TEST(test_weak_cycle_is_failed);
  RUN_TEST(test_good_cycle_is_ok);
  RUN_TEST(test_delta_at_threshold_is_ok);
  RUN_TEST(test_invalid_sensor_is_unjudged);
  RUN_TEST(test_zero_pulses_is_unjudged);
  RUN_TEST(test_peak_survives_endcycle_trough);
  RUN_TEST(test_no_peak_is_failed);
  RUN_TEST(test_vpd_typical_indoor);
  RUN_TEST(test_vpd_humid_summer);
  RUN_TEST(test_vpd_dry_winter);
  RUN_TEST(test_vpd_saturated);
  RUN_TEST(test_vpd_supersaturated_clamped);
  RUN_TEST(test_high_vpd_raises_dry);
  RUN_TEST(test_low_vpd_does_not_lower_the_trigger_below_the_band_edge);
  RUN_TEST(test_low_lux_leaves_the_trigger_at_the_edge);
  RUN_TEST(test_a_hot_afternoon_still_raises_above_the_edge);
  RUN_TEST(test_invalid_lux_no_modulation);
  RUN_TEST(test_vpd_high_boundary_no_change);
  RUN_TEST(test_vpd_low_boundary_no_change);
  RUN_TEST(test_dry_rate_boundary_no_change);
  RUN_TEST(test_vpd_and_drying_stack);
  RUN_TEST(test_fast_drying_raises_dry);
  RUN_TEST(test_a_real_drying_rate_raises_the_threshold_proportionally);
  RUN_TEST(test_a_steep_drying_rate_is_capped);
  RUN_TEST(test_stale_wire_suppresses_vpd_keeps_drying);
  RUN_TEST(test_no_env_no_modulation);
  RUN_TEST(test_combined_modulation);
  RUN_TEST(test_high_vpd_triggers_earlier);
  RUN_TEST(test_low_vpd_does_not_delay_watering_below_the_edge);
  RUN_TEST(test_plan_names_are_the_wire_spelling);
  RUN_TEST(test_plan_profiles_clamp_to_the_seasonal_preset);
  RUN_TEST(test_only_a_deep_soak_changes_the_soak_and_only_a_top_up_the_count);
  RUN_TEST(test_a_runtime_without_a_profile_runs_the_seasonal_preset);
  return UNITY_END();
}
