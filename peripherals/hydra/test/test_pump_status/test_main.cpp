#include <unity.h>

#include <domain/pump_status.h>

using namespace hydra;

// Mirrors the "Node operating status" scenarios in features/fleet_status.feature.
// derivePumpStatus is the single priority ladder, so it is host-tested here.
// Argument order: fault, forced, phase, paused, disabled, timeBlocked.

void setUp() {}
void tearDown() {}

// Scenario: A manually forced pump reads as watering, not paused (the regression).
void test_forced_while_paused_is_watering() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, true, PumpPhase::Idle, true, false, false) ==
                   PumpStatus::Watering);
}

// Scenario: An auto pulse cycle reads as pulsing or soaking.
void test_pulse_on_is_pulse() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::PulseOn, false, false, false) ==
                   PumpStatus::Pulse);
}

void test_pulse_off_is_soak() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::PulseOff, false, false, false) ==
                   PumpStatus::Soak);
}

// Scenario: A dormant (winter) zone reads as dormant.
void test_disabled_is_dormant() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::Idle, false, true, false) ==
                   PumpStatus::Dormant);
}

// Scenario: A fault outranks every other state.
void test_fault_outranks_all() {
  TEST_ASSERT_TRUE(derivePumpStatus(true, true, PumpPhase::PulseOn, true, true, true) ==
                   PumpStatus::Fault);
}

// Paused (no pump, not dormant) reads as paused.
void test_paused_is_paused() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::Idle, true, false, false) ==
                   PumpStatus::Paused);
}

// Time-of-day gate, nothing else active, reads as wait.
void test_time_blocked_is_wait() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::Idle, false, false, true) ==
                   PumpStatus::Wait);
}

// Nothing active reads as idle.
void test_default_is_idle() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::Idle, false, false, false) ==
                   PumpStatus::Idle);
}

// An auto pulse outranks the time gate (an in-progress cycle is never "waiting").
void test_pulse_outranks_wait() {
  TEST_ASSERT_TRUE(derivePumpStatus(false, false, PumpPhase::PulseOn, false, false, true) ==
                   PumpStatus::Pulse);
}

// Labels stay in sync with the enum.
void test_labels() {
  TEST_ASSERT_EQUAL_STRING("WATER", pumpStatusLabel(PumpStatus::Watering));
  TEST_ASSERT_EQUAL_STRING("PAUSE", pumpStatusLabel(PumpStatus::Paused));
  TEST_ASSERT_EQUAL_STRING("DORM", pumpStatusLabel(PumpStatus::Dormant));
  TEST_ASSERT_EQUAL_STRING("FAULT", pumpStatusLabel(PumpStatus::Fault));
  TEST_ASSERT_EQUAL_STRING("IDLE", pumpStatusLabel(PumpStatus::Idle));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_forced_while_paused_is_watering);
  RUN_TEST(test_pulse_on_is_pulse);
  RUN_TEST(test_pulse_off_is_soak);
  RUN_TEST(test_disabled_is_dormant);
  RUN_TEST(test_fault_outranks_all);
  RUN_TEST(test_paused_is_paused);
  RUN_TEST(test_time_blocked_is_wait);
  RUN_TEST(test_default_is_idle);
  RUN_TEST(test_pulse_outranks_wait);
  RUN_TEST(test_labels);
  return UNITY_END();
}
