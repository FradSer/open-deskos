#include <unity.h>
uint32_t sdkNow = 0;
#include "../../src/shared/esp_now_transport.cpp"
using namespace hydra;
void setUp() {
  sdkSends = 0;
  sdkAutoCallback = false;
  sdkReject = false;
}
void tearDown() {
  EspNowTransport transport;
  transport.end();
}
void test_sub_profile_retains_original_transport_behavior() {
  EspNowTransport transport;
  TEST_ASSERT_TRUE(transport.begin(1));
  FleetMessage frame{};
  frame.version = kFleetProtocolVersion;
  frame.type = static_cast<uint8_t>(FleetMsgType::EnvBroadcast);
  TEST_ASSERT_TRUE(transport.broadcast(frame));
  TEST_ASSERT_TRUE(transport.broadcast(frame));
  TEST_ASSERT_EQUAL(2, sdkSends);
  // The host-only destination filter does not change the copied sub-node protocol.
  uint8_t source[6] = {2, 0, 0, 0, 0, 2}, local[6] = {2, 0, 0, 0, 0, 1};
  esp_now_recv_info_t info{source, local};
  sdkReceive(&info, reinterpret_cast<uint8_t*>(&frame), sizeof(frame));
  FleetMessage received{};
  TEST_ASSERT_TRUE(transport.poll(received));
  TEST_ASSERT_EQUAL(frame.type, received.type);
  uint8_t key[16] = {1};
  TEST_ASSERT_FALSE(transport.configureHost(source, key, key));
  TEST_ASSERT_FALSE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_sub_profile_retains_original_transport_behavior);
  return UNITY_END();
}
