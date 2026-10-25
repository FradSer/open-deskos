#include <unity.h>

#include <main_node/app/link_recovery.h>

using namespace hydra;

namespace {

constexpr LinkRecoveryConfig kConfig{
    30000U,
    60000U,
    300000U,
};

}  // namespace

void setUp() {}
void tearDown() {}

// Scenario: A prolonged Wi-Fi outage escalates to a device restart.
void test_wifi_outage_escalates_through_bounded_steps() {
  LinkRecovery recovery(kConfig);

  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(1000U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(30999U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::NudgeWifi, recovery.tick(31000U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(60999U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::RestartRadio, recovery.tick(61000U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(300999U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::RestartDevice, recovery.tick(301000U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(301001U, false, false));
}

// Scenario: A prolonged broker-only outage also escalates to a device restart.
void test_mqtt_outage_escalates_even_while_wifi_is_associated() {
  LinkRecovery recovery(kConfig);

  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(500U, true, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::NudgeWifi, recovery.tick(30500U, true, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::RestartRadio, recovery.tick(60500U, true, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::RestartDevice, recovery.tick(300500U, true, false));
}

// Scenario: Connectivity recovery resets after a healthy MQTT session.
void test_healthy_session_resets_the_recovery_window() {
  LinkRecovery recovery(kConfig);

  recovery.tick(1000U, false, false);
  TEST_ASSERT_EQUAL(LinkRecoveryAction::NudgeWifi, recovery.tick(31000U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(40000U, true, true));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(200000U, true, true));

  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(250000U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(279999U, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::NudgeWifi, recovery.tick(280000U, false, false));
}

void test_outage_tracking_handles_millis_wrap() {
  LinkRecovery recovery(kConfig);
  constexpr uint32_t start = 0xFFFFFF00U;

  TEST_ASSERT_EQUAL(LinkRecoveryAction::None, recovery.tick(start, false, false));
  TEST_ASSERT_EQUAL(LinkRecoveryAction::NudgeWifi,
                    recovery.tick(start + kConfig.wifiNudgeMs, false, false));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_wifi_outage_escalates_through_bounded_steps);
  RUN_TEST(test_mqtt_outage_escalates_even_while_wifi_is_associated);
  RUN_TEST(test_healthy_session_resets_the_recovery_window);
  RUN_TEST(test_outage_tracking_handles_millis_wrap);
  return UNITY_END();
}
