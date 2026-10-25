#include <unity.h>

#include <domain/fleet_codec.h>

using namespace hydra;

// Mirrors features/ota_announce.feature. makeOtaAnnounce is the single construction
// point for the OtaAnnounce frame, host-tested like the other builders.

void setUp() {}
void tearDown() {}

// Scenario: An OtaAnnounce carries the version, size, sha, ip, port and seq.
void test_ota_announce_fields() {
  const uint8_t sha[32] = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                           0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
                           0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
                           0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x01};
  const uint8_t ip[4] = {192, 168, 1, 10};
  FleetMessage m = makeOtaAnnounce(7, 131072, sha, ip, 8080, 42);
  TEST_ASSERT_EQUAL_UINT8(kFleetProtocolVersion, m.version);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::OtaAnnounce), m.type);
  TEST_ASSERT_EQUAL_UINT8(0, m.nodeId);  // broadcast
  TEST_ASSERT_EQUAL_UINT32(7, m.otaVersion);
  TEST_ASSERT_EQUAL_UINT32(131072, m.otaBinSize);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(sha, m.otaSha256, 32);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(ip, m.otaIp, 4);
  TEST_ASSERT_EQUAL_UINT16(8080, m.otaPort);
  TEST_ASSERT_EQUAL_UINT32(42, m.otaSeq);
}

// Scenario: Unused payload fields stay zero on an OtaAnnounce.
void test_ota_announce_unused_zero() {
  const uint8_t sha[32] = {};
  const uint8_t ip[4] = {};
  FleetMessage m = makeOtaAnnounce(1, 1, sha, ip, 80, 1);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, m.tempC);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, m.vpdKpa);
  TEST_ASSERT_EQUAL_INT32(0, m.soilRaw);
  TEST_ASSERT_EQUAL_UINT8(0, m.pumpOn);
  TEST_ASSERT_EQUAL_UINT8(0, m.viewOn);
  TEST_ASSERT_EQUAL_UINT8(0, m.channel);
  TEST_ASSERT_EQUAL_UINT8(0, m.hour);
  TEST_ASSERT_EQUAL_UINT8(0, m.minute);
  TEST_ASSERT_EQUAL_UINT8(0, m.month);
  const uint8_t zero[6] = {0, 0, 0, 0, 0, 0};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(zero, m.mac, 6);
}

// Scenario: A PskDelivery carries the sub's MAC + home Wi-Fi SSID/PSK.
void test_psk_delivery_fields() {
  const uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF};
  FleetMessage m = makePskDelivery(mac, "Vault 8", "test-psk-not-real");
  TEST_ASSERT_EQUAL_UINT8(kFleetProtocolVersion, m.version);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::PskDelivery), m.type);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(mac, m.mac, 6);
  TEST_ASSERT_EQUAL_STRING("Vault 8", m.ssid);
  TEST_ASSERT_EQUAL_STRING("test-psk-not-real", m.psk);
  // Unused fields stay zero
  TEST_ASSERT_EQUAL_UINT32(0, m.otaVersion);
  TEST_ASSERT_EQUAL_UINT16(0, m.otaPort);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_ota_announce_fields);
  RUN_TEST(test_ota_announce_unused_zero);
  RUN_TEST(test_psk_delivery_fields);
  return UNITY_END();
}
