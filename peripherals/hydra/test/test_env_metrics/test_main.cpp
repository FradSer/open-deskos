#include <unity.h>

#include <domain/env_metrics.h>

using namespace hydra;

// Scenario: The main node derives VPD from a valid reading
void test_valid_reading_derives_vpd() {
  EnvReading e{25.0f, 60.0f, 101325.0f, 5000.0f, true, true};
  EnvMetrics m = computeEnvMetrics(e);
  TEST_ASSERT_TRUE(m.valid);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 1.26f, m.vpdKpa);
}

// Scenario: raw fields pass through unchanged
void test_raw_fields_pass_through() {
  EnvReading e{22.5f, 55.0f, 100200.0f, 1234.0f, true, true};
  EnvMetrics m = computeEnvMetrics(e);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 22.5f, m.tempC);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 55.0f, m.humidity);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 100200.0f, m.pressurePa);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1234.0f, m.lux);
}

// Scenario: An invalid reading produces no derived metrics
void test_invalid_reading_no_metrics() {
  EnvReading e{0.0f, 0.0f, 0.0f, 0.0f, false, false};
  EnvMetrics m = computeEnvMetrics(e);
  TEST_ASSERT_FALSE(m.valid);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, m.vpdKpa);
}

// Scenario: Lux validity is tracked independently of the core reading
void test_lux_valid_independent() {
  EnvReading e{25.0f, 60.0f, 101325.0f, 0.0f, true, false};  // lux read failed
  EnvMetrics m = computeEnvMetrics(e);
  TEST_ASSERT_TRUE(m.valid);
  TEST_ASSERT_FALSE(m.luxValid);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 1.26f, m.vpdKpa);  // core metrics still derived
}

// Scenario: Humidity above 100% RH yields zero VPD, never negative
void test_supersaturated_reading_clamps_vpd() {
  EnvReading e{25.0f, 105.0f, 101325.0f, 5000.0f, true, true};  // condensing
  EnvMetrics m = computeEnvMetrics(e);
  TEST_ASSERT_TRUE(m.valid);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, m.vpdKpa);
  TEST_ASSERT_TRUE(m.vpdKpa >= 0.0f);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_valid_reading_derives_vpd);
  RUN_TEST(test_raw_fields_pass_through);
  RUN_TEST(test_invalid_reading_no_metrics);
  RUN_TEST(test_lux_valid_independent);
  RUN_TEST(test_supersaturated_reading_clamps_vpd);
  return UNITY_END();
}
