#include <unity.h>

#include <main_node/hal/main_clock.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

// Scenario: An unset RTC produces an invalid environment time slice.
void test_unset_rtc_returns_invalid_wire_time() {
  EnvTimeSnapshot snapshot = makeEnvTimeSnapshot(2023, 14, 35, 7);

  TEST_ASSERT_EQUAL_UINT8(EnvTimeSnapshot::kInvalid, snapshot.hour);
  TEST_ASSERT_EQUAL_UINT8(EnvTimeSnapshot::kInvalid, snapshot.minute);
  TEST_ASSERT_EQUAL_UINT8(EnvTimeSnapshot::kInvalid, snapshot.month);
}

// Scenario: A valid RTC produces an environment time slice.
void test_valid_rtc_returns_wire_time() {
  EnvTimeSnapshot snapshot = makeEnvTimeSnapshot(2026, 14, 35, 7);

  TEST_ASSERT_EQUAL_UINT8(14, snapshot.hour);
  TEST_ASSERT_EQUAL_UINT8(35, snapshot.minute);
  TEST_ASSERT_EQUAL_UINT8(7, snapshot.month);
}

void test_out_of_range_rtc_fields_return_invalid_wire_time() {
  EnvTimeSnapshot snapshot = makeEnvTimeSnapshot(2026, 24, 35, 7);

  TEST_ASSERT_EQUAL_UINT8(EnvTimeSnapshot::kInvalid, snapshot.hour);
  TEST_ASSERT_EQUAL_UINT8(EnvTimeSnapshot::kInvalid, snapshot.minute);
  TEST_ASSERT_EQUAL_UINT8(EnvTimeSnapshot::kInvalid, snapshot.month);
}

// Scenario: SNTP begins only once after Wi-Fi connects.
void test_sntp_start_requires_wifi_and_an_unstarted_service() {
  TEST_ASSERT_FALSE(shouldStartSntp(false, false));
  TEST_ASSERT_TRUE(shouldStartSntp(true, false));
  TEST_ASSERT_FALSE(shouldStartSntp(true, true));
}

// Scenario: A synchronized system clock is written to the RTC once.
void test_system_clock_sync_marker_requires_a_recent_epoch() {
  TEST_ASSERT_FALSE(isSystemClockSynchronized(kMainClockSyncedEpochFloor - 1));
  TEST_ASSERT_TRUE(isSystemClockSynchronized(kMainClockSyncedEpochFloor));
  TEST_ASSERT_TRUE(shouldPushRtc(true, false));
  TEST_ASSERT_FALSE(shouldPushRtc(true, true));
}

// Scenario: A disciplined system clock outranks the drifting RTC.
void test_synced_system_clock_outranks_the_drifting_rtc() {
  EnvTimeSnapshot system = makeEnvTimeSnapshot(2026, 2, 40, 9);
  EnvTimeSnapshot rtc = makeEnvTimeSnapshot(2026, 2, 29, 9);

  EnvTimeSnapshot chosen = selectWireTime(true, system, rtc);

  TEST_ASSERT_EQUAL_UINT8(2, chosen.hour);
  TEST_ASSERT_EQUAL_UINT8(40, chosen.minute);
}

// Scenario: The RTC is the fallback before the first sync.
void test_unsynced_system_clock_falls_back_to_the_rtc() {
  EnvTimeSnapshot invalid{EnvTimeSnapshot::kInvalid, EnvTimeSnapshot::kInvalid,
                          EnvTimeSnapshot::kInvalid};
  EnvTimeSnapshot rtc = makeEnvTimeSnapshot(2026, 2, 29, 9);

  EnvTimeSnapshot chosen = selectWireTime(false, invalid, rtc);

  TEST_ASSERT_EQUAL_UINT8(2, chosen.hour);
  TEST_ASSERT_EQUAL_UINT8(29, chosen.minute);
}

// Scenario: SNTP is re-armed while a sync has not landed.
void test_sntp_is_rearmed_until_a_sync_lands() {
  constexpr uint32_t kRetryMs = 60000U;

  TEST_ASSERT_FALSE(shouldRetrySntp(false, false, 100000U, 0U, kRetryMs));
  TEST_ASSERT_FALSE(shouldRetrySntp(true, true, 100000U, 0U, kRetryMs));
  TEST_ASSERT_FALSE(shouldRetrySntp(true, false, 30000U, 0U, kRetryMs));
  TEST_ASSERT_TRUE(shouldRetrySntp(true, false, 60000U, 0U, kRetryMs));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_unset_rtc_returns_invalid_wire_time);
  RUN_TEST(test_valid_rtc_returns_wire_time);
  RUN_TEST(test_out_of_range_rtc_fields_return_invalid_wire_time);
  RUN_TEST(test_sntp_start_requires_wifi_and_an_unstarted_service);
  RUN_TEST(test_system_clock_sync_marker_requires_a_recent_epoch);
  RUN_TEST(test_synced_system_clock_outranks_the_drifting_rtc);
  RUN_TEST(test_unsynced_system_clock_falls_back_to_the_rtc);
  RUN_TEST(test_sntp_is_rearmed_until_a_sync_lands);
  return UNITY_END();
}
