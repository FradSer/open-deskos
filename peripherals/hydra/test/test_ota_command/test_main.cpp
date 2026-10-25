#include <unity.h>

#include <cstdio>

#include <main_node/app/ota.h>
#include <main_node/hal/mqtt_link.h>

using namespace hydra;

// Mirrors features/main_node_ota.feature. parseOtaCommand + shouldApplyOta are
// pure logic, host-tested here once for the main-node composition root.

void setUp() {}
void tearDown() {}

// Scenario: A well-formed OTA command parses to its fields.
void test_parse_well_formed() {
  OtaCommand c = parseOtaCommand(
      "v=5;size=327680;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://nas/hydra/main.bin");
  TEST_ASSERT_TRUE(c.valid);
  TEST_ASSERT_EQUAL_UINT32(5, c.version);
  TEST_ASSERT_EQUAL_UINT32(327680, c.binSize);
  const uint8_t expected[32] = {0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                                0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
                                0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
                                0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, c.sha256, 32);
  TEST_ASSERT_EQUAL_STRING("http://nas/hydra/main.bin", c.url);
}

// Scenario: A maximum-length OTA URL survives MQTT ingress.
void test_maximum_length_ota_command_fits_mqtt_ingress() {
  constexpr size_t kUrlLength = sizeof(OtaCommand{}.url) - 1;
  constexpr size_t kMaxCommandLength =
      sizeof("v=4294967295;size=4294967295;sha=") - 1 + 64 + sizeof(";url=") - 1 +
      kUrlLength;
  static_assert(kMaxCommandLength > 128,
                "Regression fixture must exceed the old MQTT ingress capacity");
  static_assert(sizeof(MqttLink::Incoming{}.payload) >= kMaxCommandLength + 1,
                "MQTT ingress must hold the largest supported OTA command plus NUL");

  char url[sizeof(OtaCommand{}.url)] = "http://nas/";
  size_t prefixLength = strlen(url);
  memset(url + prefixLength, 'a', kUrlLength - prefixLength);
  url[kUrlLength] = '\0';

  char payload[sizeof(MqttLink::Incoming{}.payload)] = {};
  int length = snprintf(payload, sizeof(payload),
                        "v=4294967295;size=4294967295;sha="
                        "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;"
                        "url=%s",
                        url);
  TEST_ASSERT_EQUAL_INT(kMaxCommandLength, length);

  OtaCommand command = parseOtaCommand(payload);
  TEST_ASSERT_TRUE(command.valid);
  TEST_ASSERT_EQUAL_STRING(url, command.url);
}

// Uppercase hex is accepted too.
void test_parse_uppercase_sha() {
  OtaCommand c = parseOtaCommand(
      "v=1;size=10;sha=0102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F20;url=http://x/y.bin");
  TEST_ASSERT_TRUE(c.valid);
  TEST_ASSERT_EQUAL_UINT8(0x0A, c.sha256[9]);   // 0A in either case
  TEST_ASSERT_EQUAL_UINT8(0x1F, c.sha256[30]);  // 1F (uppercase) at byte 30
  TEST_ASSERT_EQUAL_UINT8(0x20, c.sha256[31]);  // 20 at byte 31
}

// Scenario: A higher version applies.
void test_should_apply_higher() {
  OtaCommand c = parseOtaCommand(
      "v=5;size=1;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://x/y.bin");
  TEST_ASSERT_TRUE(shouldApplyOta(c, 3));
}

// Scenario: An equal or lower version is ignored.
void test_should_not_apply_equal() {
  OtaCommand c = parseOtaCommand(
      "v=3;size=1;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://x/y.bin");
  TEST_ASSERT_FALSE(shouldApplyOta(c, 3));
}

void test_should_not_apply_lower() {
  OtaCommand c = parseOtaCommand(
      "v=2;size=1;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://x/y.bin");
  TEST_ASSERT_FALSE(shouldApplyOta(c, 3));
}

// An invalid command never applies, regardless of version.
void test_should_not_apply_invalid() {
  OtaCommand c = parseOtaCommand("v=99;size=1;url=http://x/y.bin");  // no sha
  TEST_ASSERT_FALSE(c.valid);
  TEST_ASSERT_FALSE(shouldApplyOta(c, 0));
}

// Scenario: A payload missing a field is invalid.
void test_parse_missing_field() {
  OtaCommand c = parseOtaCommand("v=5;size=327680;url=http://nas/hydra/main.bin");
  TEST_ASSERT_FALSE(c.valid);
}

// Scenario: A payload with a bad sha hex is invalid.
void test_parse_bad_sha_hex() {
  OtaCommand c = parseOtaCommand("v=5;size=327680;sha=zz;url=http://nas/hydra/main.bin");
  TEST_ASSERT_FALSE(c.valid);
}

// Scenario: A payload with a sha of the wrong length is invalid.
void test_parse_wrong_sha_length() {
  OtaCommand c = parseOtaCommand("v=5;size=327680;sha=0102;url=http://nas/hydra/main.bin");
  TEST_ASSERT_FALSE(c.valid);
}

// A null payload is invalid.
void test_parse_null() {
  OtaCommand c = parseOtaCommand(nullptr);
  TEST_ASSERT_FALSE(c.valid);
}

// A duplicate key is invalid (defends against a replay smuggling a second v=).
void test_parse_duplicate_key() {
  OtaCommand c = parseOtaCommand(
      "v=5;size=1;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://x/y.bin;v=6");
  TEST_ASSERT_FALSE(c.valid);
}

// Overflowing u32 version or size must never be narrowed/truncated.
void test_parse_overflowing_u32_metadata_is_invalid() {
  const char* sha = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  char payload[256];
  snprintf(payload, sizeof(payload), "v=4294967296;size=1;sha=%s;url=http://x/y.bin", sha);
  TEST_ASSERT_FALSE(parseOtaCommand(payload).valid);
  snprintf(payload, sizeof(payload), "v=1;size=4294967296;sha=%s;url=http://x/y.bin", sha);
  TEST_ASSERT_FALSE(parseOtaCommand(payload).valid);
  snprintf(payload, sizeof(payload), "v=999999999999999999999999;size=1;sha=%s;url=http://x/y.bin", sha);
  TEST_ASSERT_FALSE(parseOtaCommand(payload).valid);
  snprintf(payload, sizeof(payload), "v=1;size=999999999999999999999999;sha=%s;url=http://x/y.bin", sha);
  TEST_ASSERT_FALSE(parseOtaCommand(payload).valid);
}

// An unknown key is invalid.
void test_parse_unknown_key() {
  OtaCommand c = parseOtaCommand(
      "v=5;size=1;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://x/y.bin;extra=1");
  TEST_ASSERT_FALSE(c.valid);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_parse_well_formed);
  RUN_TEST(test_maximum_length_ota_command_fits_mqtt_ingress);
  RUN_TEST(test_parse_uppercase_sha);
  RUN_TEST(test_should_apply_higher);
  RUN_TEST(test_should_not_apply_equal);
  RUN_TEST(test_should_not_apply_lower);
  RUN_TEST(test_should_not_apply_invalid);
  RUN_TEST(test_parse_missing_field);
  RUN_TEST(test_parse_bad_sha_hex);
  RUN_TEST(test_parse_wrong_sha_length);
  RUN_TEST(test_parse_null);
  RUN_TEST(test_parse_duplicate_key);
  RUN_TEST(test_parse_overflowing_u32_metadata_is_invalid);
  RUN_TEST(test_parse_unknown_key);
  return UNITY_END();
}
