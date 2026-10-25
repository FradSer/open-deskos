#include <unity.h>

#include <domain/ota_session.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

// SHA mismatch happens before esp_ota_end, so the writer must abort exactly once.
void test_sha_mismatch_releases_an_active_session_once() {
  OtaSession session;
  session.begin();

  TEST_ASSERT_TRUE(session.takeForAbort());
  TEST_ASSERT_FALSE(session.active());
  TEST_ASSERT_FALSE(session.takeForAbort());
}

// An esp_ota_end failure still owns an active handle and must abort exactly once.
void test_ota_end_failure_releases_an_active_session_once() {
  OtaSession session;
  session.begin();

  TEST_ASSERT_TRUE(session.takeForAbort());
  TEST_ASSERT_FALSE(session.active());
  TEST_ASSERT_FALSE(session.takeForAbort());
}

// esp_ota_end() has finalized the handle before boot-partition selection begins.
void test_finalized_session_cannot_be_aborted_after_boot_partition_failure() {
  OtaSession session;
  session.begin();
  session.finalize();

  TEST_ASSERT_FALSE(session.active());
  TEST_ASSERT_FALSE(session.takeForAbort());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_sha_mismatch_releases_an_active_session_once);
  RUN_TEST(test_ota_end_failure_releases_an_active_session_once);
  RUN_TEST(test_finalized_session_cannot_be_aborted_after_boot_partition_failure);
  return UNITY_END();
}
