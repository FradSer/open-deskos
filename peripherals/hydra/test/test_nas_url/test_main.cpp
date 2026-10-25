#include <unity.h>

#include <main_node/app/nas_url.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

void test_http_ipv4_with_explicit_port_parses() {
  NasUrl url{};
  TEST_ASSERT_TRUE(parseNasUrl("http://192.168.1.10:8080/sub.bin", url));
  const uint8_t expected[] = {192, 168, 1, 10};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, url.ip, 4);
  TEST_ASSERT_EQUAL_UINT16(8080, url.port);
}

void test_http_ipv4_without_port_uses_80() {
  NasUrl url{};
  TEST_ASSERT_TRUE(parseNasUrl("http://10.0.0.2/path", url));
  TEST_ASSERT_EQUAL_UINT16(80, url.port);
}

void test_invalid_sub_ota_urls_are_rejected() {
  NasUrl url{};
  TEST_ASSERT_FALSE(parseNasUrl("https://192.168.1.10/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10:0/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10:65536/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10:70000/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10:abc/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10:80junk/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.256/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10?campaign=1", url));
  // Regression: digit accumulation must reject before unsigned-long wraparound.
  TEST_ASSERT_FALSE(parseNasUrl("http://999999999999999999999999999999.1.1.1/sub.bin", url));
  TEST_ASSERT_FALSE(parseNasUrl("http://192.168.1.10:999999999999999999999999999999/sub.bin", url));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_http_ipv4_with_explicit_port_parses);
  RUN_TEST(test_http_ipv4_without_port_uses_80);
  RUN_TEST(test_invalid_sub_ota_urls_are_rejected);
  return UNITY_END();
}
