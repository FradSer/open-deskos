#include <unity.h>

#include <domain/pairing_feedback.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

void test_manual_pairing_blinks_over_spotlight() {
  PairingFeedback feedback;
  feedback.setSpotlight(true, 100);
  feedback.startManualPairing(200);

  TEST_ASSERT_TRUE(feedback.ledOn(250));
  TEST_ASSERT_FALSE(feedback.ledOn(375));
}

void test_manual_pair_success_confirms_before_spotlight_returns() {
  PairingFeedback feedback;
  feedback.setSpotlight(true, 100);
  feedback.startManualPairing(200);
  feedback.confirmManualPairing(300);

  TEST_ASSERT_TRUE(feedback.ledOn(2299));
  TEST_ASSERT_TRUE(feedback.ledOn(2300));
}

void test_confirmation_expires_to_spotlight() {
  PairingFeedback feedback;
  feedback.setSpotlight(true, 100);
  feedback.startManualPairing(200);
  feedback.confirmManualPairing(300);

  TEST_ASSERT_TRUE(feedback.ledOn(2300));

  PairingFeedback withoutSpotlight;
  withoutSpotlight.startManualPairing(200);
  withoutSpotlight.confirmManualPairing(300);
  TEST_ASSERT_FALSE(withoutSpotlight.ledOn(2300));
}

void test_spotlight_expires() {
  PairingFeedback feedback;
  feedback.setSpotlight(true, 100);

  TEST_ASSERT_TRUE(feedback.ledOn(3099));
  TEST_ASSERT_FALSE(feedback.ledOn(3100));
}

void test_pairing_times_out() {
  PairingFeedback feedback;
  feedback.startManualPairing(100);

  TEST_ASSERT_TRUE(feedback.pairingActive(30099));
  TEST_ASSERT_FALSE(feedback.pairingActive(30100));
  TEST_ASSERT_FALSE(feedback.ledOn(30100));
}

// Scenario: Automatic channel recovery stays visually silent.
void test_recovery_without_manual_pairing_stays_silent() {
  PairingFeedback feedback;

  TEST_ASSERT_FALSE(feedback.pairingActive(100));
  TEST_ASSERT_FALSE(feedback.ledOn(100));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_manual_pairing_blinks_over_spotlight);
  RUN_TEST(test_manual_pair_success_confirms_before_spotlight_returns);
  RUN_TEST(test_confirmation_expires_to_spotlight);
  RUN_TEST(test_spotlight_expires);
  RUN_TEST(test_pairing_times_out);
  RUN_TEST(test_recovery_without_manual_pairing_stays_silent);
  return UNITY_END();
}
