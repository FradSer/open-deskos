#include <unity.h>

#include <domain/soil_history.h>

using namespace hydra;

// Fresh history has no rate yet
void test_empty_is_invalid() {
  SoilHistory<8> h;
  TEST_ASSERT_FALSE(h.valid());
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, h.dryingRate());
}

// One sample is still not enough
void test_one_sample_invalid() {
  SoilHistory<8> h;
  h.record(50.0f, 0);
  TEST_ASSERT_FALSE(h.valid());
}

// Two samples become valid
void test_two_samples_valid() {
  SoilHistory<8> h;
  h.record(50.0f, 0);
  h.record(48.0f, 3600000);  // 1 h later
  TEST_ASSERT_TRUE(h.valid());
}

// Drying: soil fell 10% over 2 h -> -5 %/h
void test_drying_rate_negative() {
  SoilHistory<8> h;
  h.record(60.0f, 0);
  h.record(50.0f, 7200000);  // 2 h later, -10%
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -5.0f, h.dryingRate());
}

// Wetting (after watering): positive rate
void test_wetting_rate_positive() {
  SoilHistory<8> h;
  h.record(30.0f, 0);
  h.record(42.0f, 3600000);  // +12% over 1 h
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 12.0f, h.dryingRate());
}

// Span shorter than the minimum returns 0 (too little time to extrapolate)
void test_short_span_returns_zero() {
  SoilHistory<8> h;
  h.record(50.0f, 0);
  h.record(49.0f, 30000);  // only 30 s apart, below 60 s default
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, h.dryingRate());
}

// Ring wraps: oldest sample is evicted, rate uses the live window
void test_ring_wraps_to_window() {
  SoilHistory<3> h;
  h.record(90.0f, 0);          // will be evicted
  h.record(60.0f, 3600000);    // oldest in window after wrap
  h.record(50.0f, 7200000);
  h.record(40.0f, 10800000);   // evicts the 90 sample; window = 60->40 over 2 h
  TEST_ASSERT_TRUE(h.valid());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -10.0f, h.dryingRate());  // -20% / 2 h
}

// Least-squares uses every sample, not just the endpoints. The trend below is
// noisy (50,48,46,30 at 0..3 h): the oldest/newest endpoints alone read -6.67 %/h,
// but the regression over all four points reads -6.2 %/h.
void test_least_squares_uses_all_samples() {
  SoilHistory<8> h;
  h.record(50.0f, 0);
  h.record(48.0f, 3600000);
  h.record(46.0f, 7200000);
  h.record(30.0f, 10800000);
  TEST_ASSERT_FLOAT_WITHIN(0.05f, -6.2f, h.dryingRate());
}

// A span exactly at the minimum is computed (the guard is strict `< minSpanMs`).
void test_span_equals_min_computes() {
  SoilHistory<8> h;
  h.record(50.0f, 0);
  h.record(49.5f, 60000);  // exactly 60 s -> -0.5% over 1 min = -30 %/h
  TEST_ASSERT_FLOAT_WITHIN(0.1f, -30.0f, h.dryingRate());
}

// Samples straddling the ~49-day millis() rollover still yield the true rate:
// the oldest-relative unsigned subtraction recovers the real 1 h elapsed.
void test_millis_wrap() {
  SoilHistory<8> h;
  h.record(60.0f, 4293167295U);  // ~30 min before UINT32_MAX
  h.record(50.0f, 1799999U);     // wrapped: 1 h after the first sample
  TEST_ASSERT_TRUE(h.valid());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, -10.0f, h.dryingRate());  // -10% / 1 h
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_empty_is_invalid);
  RUN_TEST(test_one_sample_invalid);
  RUN_TEST(test_two_samples_valid);
  RUN_TEST(test_drying_rate_negative);
  RUN_TEST(test_wetting_rate_positive);
  RUN_TEST(test_short_span_returns_zero);
  RUN_TEST(test_ring_wraps_to_window);
  RUN_TEST(test_least_squares_uses_all_samples);
  RUN_TEST(test_span_equals_min_computes);
  RUN_TEST(test_millis_wrap);
  return UNITY_END();
}
