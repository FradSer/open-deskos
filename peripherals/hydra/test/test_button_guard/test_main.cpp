#include <unity.h>

#include <domain/button_guard.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

void test_boot_held_button_enters_reconfigure_after_hold() {
  ButtonArmState state;
  TEST_ASSERT_FALSE(observeBootButton(state, true, 0, 250));
  TEST_ASSERT_FALSE(observeBootButton(state, true, 249, 250));
  TEST_ASSERT_TRUE(observeBootButton(state, true, 250, 250));
}

void test_boot_button_release_before_hold_cancels_reconfigure() {
  ButtonArmState state;
  TEST_ASSERT_FALSE(observeBootButton(state, true, 0, 250));
  TEST_ASSERT_FALSE(observeBootButton(state, false, 100, 250));
  TEST_ASSERT_FALSE(observeBootButton(state, true, 500, 250));
}

void test_runtime_press_cannot_start_reconfigure() {
  ButtonArmState state;
  TEST_ASSERT_FALSE(observeBootButton(state, false, 0, 250));
  TEST_ASSERT_FALSE(observeBootButton(state, true, 250, 250));
  TEST_ASSERT_FALSE(observeBootButton(state, true, 500, 250));
}

void test_reconfigure_state_latches_once_started() {
  ButtonArmState state;
  TEST_ASSERT_FALSE(observeBootButton(state, true, 0, 250));
  TEST_ASSERT_TRUE(observeBootButton(state, true, 250, 250));
  TEST_ASSERT_TRUE(observeBootButton(state, false, 300, 250));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_boot_held_button_enters_reconfigure_after_hold);
  RUN_TEST(test_boot_button_release_before_hold_cancels_reconfigure);
  RUN_TEST(test_runtime_press_cannot_start_reconfigure);
  RUN_TEST(test_reconfigure_state_latches_once_started);
  return UNITY_END();
}
