#include <unity.h>

#include <sub_node/hal/wire_clock.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

void test_fresh_invalid() {
  WireClock clock;
  TEST_ASSERT_FALSE(clock.isValid());
  TEST_ASSERT_EQUAL(-1, clock.currentHour());
  TEST_ASSERT_EQUAL(-1, clock.currentMonth());
}

void test_update_makes_valid() {
  WireClock clock;
  clock.update(7, 30, 10, 1000);
  TEST_ASSERT_TRUE(clock.isValid());
  TEST_ASSERT_EQUAL(7, clock.currentHour());
  TEST_ASSERT_EQUAL(10, clock.currentMonth());
}

void test_update_resnaps() {
  WireClock clock;
  clock.update(7, 30, 10, 1000);
  clock.update(8, 15, 10, 2000);
  TEST_ASSERT_EQUAL(8, clock.currentHour());
}

// The pre-SNTP marker does not itself discard a trusted cached time.
void test_invalid_marker_is_ignored_until_runtime_staleness() {
  WireClock clock;
  clock.update(7, 30, 10, 1000);
  clock.update(WireClock::kInvalid, WireClock::kInvalid, WireClock::kInvalid, 2000);
  TEST_ASSERT_TRUE(clock.isValid());
  TEST_ASSERT_EQUAL(7, clock.currentHour());
}

void test_tick_advances_clock_between_fresh_broadcasts() {
  WireClock clock;
  clock.update(7, 30, 10, 1000);
  clock.tick(1000 + 61 * 60000);
  TEST_ASSERT_TRUE(clock.isValid());
  TEST_ASSERT_EQUAL(8, clock.currentHour());
  TEST_ASSERT_EQUAL(31, clock.currentMinute());
}

void test_stale_invalidation_blocks_clock_until_fresh_broadcast() {
  WireClock clock;
  clock.update(14, 30, 10, 1000);
  clock.invalidate();

  TEST_ASSERT_FALSE(clock.isValid());
  TEST_ASSERT_EQUAL(-1, clock.currentHour());
  TEST_ASSERT_EQUAL(-1, clock.currentMonth());

  clock.update(16, 0, 10, 2000);
  TEST_ASSERT_TRUE(clock.isValid());
  TEST_ASSERT_EQUAL(16, clock.currentHour());
}

void test_tick_noop_before_first_valid_time_or_after_invalidation() {
  WireClock clock;
  clock.tick(5000);
  TEST_ASSERT_FALSE(clock.isValid());

  clock.update(12, 0, 10, 1000);
  clock.invalidate();
  clock.tick(1000 + 3600000);
  TEST_ASSERT_FALSE(clock.isValid());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_fresh_invalid);
  RUN_TEST(test_update_makes_valid);
  RUN_TEST(test_update_resnaps);
  RUN_TEST(test_invalid_marker_is_ignored_until_runtime_staleness);
  RUN_TEST(test_tick_advances_clock_between_fresh_broadcasts);
  RUN_TEST(test_stale_invalidation_blocks_clock_until_fresh_broadcast);
  RUN_TEST(test_tick_noop_before_first_valid_time_or_after_invalidation);
  return UNITY_END();
}
