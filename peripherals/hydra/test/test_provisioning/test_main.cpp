#include <unity.h>

#include <cstring>

#include <main_node/app/provisioning.h>

using namespace hydra;

// Mirrors features/wifi_provisioning.feature: the boot-mode decision and the
// broker-address sanitation. The portal itself is thin HAL glue.

void setUp() {}
void tearDown() {}

// Scenario: First boot with nothing provisioned enters setup mode
void test_unprovisioned_boots_into_setup() {
  TEST_ASSERT_TRUE(decideBootMode(false, false) == BootMode::Setup);
}

// Scenario: A provisioned node boots straight to normal operation
void test_provisioned_boots_normal() {
  TEST_ASSERT_TRUE(decideBootMode(true, false) == BootMode::Normal);
}

// Scenario: Holding the side button at power-on forces re-provisioning
void test_setup_request_overrides_provisioned() {
  TEST_ASSERT_TRUE(decideBootMode(true, true) == BootMode::Setup);
}

// Scenario: The broker address is cleaned before being stored
void test_sanitize_trims_whitespace() {
  char host[40] = "  192.168.1.10 \r\n";
  TEST_ASSERT_TRUE(sanitizeMqttHost(host));
  TEST_ASSERT_EQUAL_STRING("192.168.1.10", host);
}

void test_sanitize_keeps_clean_host_unchanged() {
  char host[40] = "nas.local";
  TEST_ASSERT_TRUE(sanitizeMqttHost(host));
  TEST_ASSERT_EQUAL_STRING("nas.local", host);
}

void test_sanitize_rejects_empty_or_blank() {
  char empty[8] = "";
  char blank[8] = "   ";
  TEST_ASSERT_FALSE(sanitizeMqttHost(empty));
  TEST_ASSERT_FALSE(sanitizeMqttHost(blank));
  TEST_ASSERT_FALSE(sanitizeMqttHost(nullptr));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_unprovisioned_boots_into_setup);
  RUN_TEST(test_provisioned_boots_normal);
  RUN_TEST(test_setup_request_overrides_provisioned);
  RUN_TEST(test_sanitize_trims_whitespace);
  RUN_TEST(test_sanitize_keeps_clean_host_unchanged);
  RUN_TEST(test_sanitize_rejects_empty_or_blank);
  return UNITY_END();
}
