#include <unity.h>
#include "domain/plan_install_receipt.h"
using namespace hydra;
void setUp() {}
void tearDown() {}
void test_exact_retry_reports_install_without_rearming() {
  PlanInstallReceipt receipt; Timetable plan; plan.windowSeq = 9; plan.count = 0;
  int installs = 0;
  auto install = [&](const Timetable&) { ++installs; return true; };
  TEST_ASSERT_TRUE(receipt.install(plan, install));
  TEST_ASSERT_TRUE(receipt.install(plan, install)); TEST_ASSERT_EQUAL(1, installs);
  plan.count = 1; TEST_ASSERT_FALSE(receipt.install(plan, install));
  TEST_ASSERT_EQUAL(1, installs);
  plan.windowSeq = 8; TEST_ASSERT_FALSE(receipt.install(plan, install));
}
void test_failure_and_bad_plan_never_become_installed() {
  PlanInstallReceipt receipt; Timetable plan; plan.windowSeq = 1;
  TEST_ASSERT_FALSE(receipt.install(plan, [](const Timetable&) { return false; }));
  int installs = 0;
  auto install = [&](const Timetable&) { ++installs; return true; };
  plan.count = 5; TEST_ASSERT_FALSE(receipt.install(plan, install));
  TEST_ASSERT_EQUAL(0, installs);
  plan.count = 0; TEST_ASSERT_TRUE(receipt.install(plan, install));
  TEST_ASSERT_EQUAL(1, installs);
}
int main(int, char**) {
  UNITY_BEGIN(); RUN_TEST(test_exact_retry_reports_install_without_rearming);
  RUN_TEST(test_failure_and_bad_plan_never_become_installed); return UNITY_END();
}
