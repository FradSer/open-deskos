#include <unity.h>

#include <shared/ota_transfer.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

void test_http_url_with_port_and_path_parses() {
  OtaHttpUrl url{};
  TEST_ASSERT_TRUE(parseOtaHttpUrl("http://192.168.1.2:8080/firmware/main.bin", url));
  TEST_ASSERT_EQUAL_STRING("192.168.1.2", url.host);
  TEST_ASSERT_EQUAL_UINT16(8080, url.port);
  TEST_ASSERT_EQUAL_STRING("/firmware/main.bin", url.path);
}

void test_http_url_without_path_uses_default_port_and_root() {
  OtaHttpUrl url{};
  TEST_ASSERT_TRUE(parseOtaHttpUrl("http://nas", url));
  TEST_ASSERT_EQUAL_STRING("nas", url.host);
  TEST_ASSERT_EQUAL_UINT16(80, url.port);
  TEST_ASSERT_EQUAL_STRING("/", url.path);
}

void test_https_and_invalid_ports_are_rejected() {
  OtaHttpUrl url{};
  TEST_ASSERT_FALSE(parseOtaHttpUrl("https://nas/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://nas:0/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://nas:70000/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://nas:80:90/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://nas:/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://nas:80junk/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://nas:999999999999999999999999/fw.bin", url));
  TEST_ASSERT_FALSE(parseOtaHttpUrl("http://bad_host/fw.bin", url));
}

void test_transfer_plan_rejects_mismatched_size() {
  OtaTransferPlan plan = makeOtaTransferPlan(100U, 99);
  TEST_ASSERT_FALSE(plan.valid);
}

void test_transfer_plan_uses_announced_size_when_length_is_unknown() {
  OtaTransferPlan plan = makeOtaTransferPlan(100U, -1);
  TEST_ASSERT_TRUE(plan.valid);
  TEST_ASSERT_EQUAL_UINT32(100U, plan.bound);
}

void test_transfer_plan_requires_an_announced_size() {
  OtaTransferPlan plan = makeOtaTransferPlan(0U, -1);
  TEST_ASSERT_FALSE(plan.valid);
  plan = makeOtaTransferPlan(0U, 100);
  TEST_ASSERT_FALSE(plan.valid);
}

void test_transfer_bounds_and_stall() {
  OtaTransferPlan plan = makeOtaTransferPlan(100U, 100);
  TEST_ASSERT_TRUE(canAcceptOtaChunk(plan, 90U, 10U));
  TEST_ASSERT_FALSE(canAcceptOtaChunk(plan, 90U, 11U));
  TEST_ASSERT_FALSE(otaTransferStalled(1000U, 1999U, 1000U));
  TEST_ASSERT_TRUE(otaTransferStalled(1000U, 2000U, 1000U));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_http_url_with_port_and_path_parses);
  RUN_TEST(test_http_url_without_path_uses_default_port_and_root);
  RUN_TEST(test_https_and_invalid_ports_are_rejected);
  RUN_TEST(test_transfer_plan_rejects_mismatched_size);
  RUN_TEST(test_transfer_plan_uses_announced_size_when_length_is_unknown);
  RUN_TEST(test_transfer_plan_requires_an_announced_size);
  RUN_TEST(test_transfer_bounds_and_stall);
  return UNITY_END();
}
