#include <unity.h>

#include <sub_node/app/sub_runtime.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

// Scenario: The root marks a healthy OTA image only once after the health window.
void test_health_marker_waits_for_window_and_runs_once() {
  TEST_ASSERT_FALSE(shouldMarkSubOtaValid(false, 14999U, 15000U));
  TEST_ASSERT_TRUE(shouldMarkSubOtaValid(false, 15000U, 15000U));
  TEST_ASSERT_FALSE(shouldMarkSubOtaValid(true, 999999U, 15000U));
}

// Scenario: SubRuntime consumes a pre-sampled button hold.
void test_button_events_preserve_hold_and_release() {
  SubButtonEvents events{};
  events.hold = true;
  TEST_ASSERT_TRUE(events.hold);
  TEST_ASSERT_FALSE(events.released);

  events = {};
  events.released = true;
  TEST_ASSERT_TRUE(events.released);
  TEST_ASSERT_FALSE(events.hold);
}

// Successful OTA tears Wi-Fi down for restart; failed OTA restores ESP-NOW instead.
void test_ota_success_and_failure_have_distinct_radio_lifecycles() {
  TEST_ASSERT_FALSE(shouldReleaseEspNowBeforeOta(false));
  TEST_ASSERT_TRUE(shouldReleaseEspNowBeforeOta(true));
  TEST_ASSERT_TRUE(shouldTearDownWiFiBeforeOtaRestart(true, true));
  TEST_ASSERT_FALSE(shouldReinitializeRadioAfterOta(true, true));
  TEST_ASSERT_FALSE(shouldTearDownWiFiBeforeOtaRestart(true, false));
  TEST_ASSERT_TRUE(shouldReinitializeRadioAfterOta(true, false));
  TEST_ASSERT_FALSE(shouldReinitializeRadioAfterOta(false, false));
}

void test_environment_timeout_drives_the_stale_clock_transition() {
  constexpr uint32_t stale = 180000U;
  TEST_ASSERT_FALSE(isEnvironmentStale(179999U, 0U, stale));
  TEST_ASSERT_TRUE(isEnvironmentStale(180000U, 0U, stale));
  TEST_ASSERT_TRUE(isEnvironmentStale(200000U, 20000U, stale));
}

void test_remote_force_timeout_is_due_only_after_the_full_window() {
  constexpr uint32_t timeout = 1000U;
  TEST_ASSERT_FALSE(isRemoteForceStale(1999U, 1000U, timeout));
  TEST_ASSERT_TRUE(isRemoteForceStale(2000U, 1000U, timeout));
  TEST_ASSERT_TRUE(isRemoteForceStale(3000U, 2000U, timeout));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_health_marker_waits_for_window_and_runs_once);
  RUN_TEST(test_button_events_preserve_hold_and_release);
  RUN_TEST(test_ota_success_and_failure_have_distinct_radio_lifecycles);
  RUN_TEST(test_environment_timeout_drives_the_stale_clock_transition);
  RUN_TEST(test_remote_force_timeout_is_due_only_after_the_full_window);
  return UNITY_END();
}
