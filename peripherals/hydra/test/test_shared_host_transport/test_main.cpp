#include <unity.h>

#include <initializer_list>
#define HYDRA_DESKTOP_TELEMETRY 1
uint32_t sdkNow = 0;
#include "../../src/shared/esp_now_transport.cpp"
using namespace hydra;
void setUp() {
  sdkNow = 0;
  sdkSends = sdkInit = sdkReceiveRegisters = sdkSendRegisters = 0;
  sdkAutoCallback = false;
  sdkReject = false;
}
void tearDown() {
  EspNowTransport transport;
  transport.end();
}
void test_callback_loss_and_backpressure_do_not_defer_fleet() {
  EspNowTransport transport;
  uint8_t gateway[6] = {2, 0, 0, 0, 0, 9}, key[16] = {1};
  TEST_ASSERT_TRUE(transport.begin(1));
  TEST_ASSERT_TRUE(transport.configureHost(gateway, key, key));
  TEST_ASSERT_TRUE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
  FleetMessage frame{};
  frame.version = kFleetProtocolVersion;
  frame.type = static_cast<uint8_t>(FleetMsgType::PumpCommand);
  TEST_ASSERT_TRUE(transport.broadcast(frame));
  TEST_ASSERT_EQUAL(2, sdkSends);
  sdkNow = 501;
  TEST_ASSERT_FALSE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
  TEST_ASSERT_TRUE(transport.broadcast(frame));
  TEST_ASSERT_EQUAL(3, sdkSends);
  sdkReject = true;
  TEST_ASSERT_FALSE(transport.broadcast(frame));
  TEST_ASSERT_EQUAL(4, sdkSends);  // no application queue or delayed replay
  sdkReject = false;
  transport.poll(frame);
  TEST_ASSERT_EQUAL(4, sdkSends);
  TEST_ASSERT_EQUAL(1, sdkInit);
  TEST_ASSERT_EQUAL(1, sdkReceiveRegisters);
  TEST_ASSERT_EQUAL(1, sdkSendRegisters);
}
void test_legacy_unicast_injection_is_not_fleet_input() {
  EspNowTransport transport;
  TEST_ASSERT_TRUE(transport.begin(1));
  uint8_t source[6] = {2, 0, 0, 0, 0, 9}, local[6] = {2, 0, 0, 0, 0, 1},
          broadcast[6] = {255, 255, 255, 255, 255, 255};
  FleetMessage frame{};
  frame.version = kFleetProtocolVersion;
  FleetMessage result{};
  for (auto type :
       {FleetMsgType::StatusReport, FleetMsgType::PairRequest, FleetMsgType::PumpCommand,
        FleetMsgType::OtaAnnounce, FleetMsgType::PskDelivery}) {
    frame.type = static_cast<uint8_t>(type);
    esp_now_recv_info_t info{source, local};
    sdkReceive(&info, reinterpret_cast<uint8_t*>(&frame), sizeof(frame));
    TEST_ASSERT_FALSE(transport.poll(result));
  }
  sdkReceive(nullptr, reinterpret_cast<uint8_t*>(&frame), sizeof(frame));
  TEST_ASSERT_FALSE(transport.poll(result));
  frame.type = static_cast<uint8_t>(FleetMsgType::StatusReport);
  esp_now_recv_info_t info{source, broadcast};
  sdkReceive(&info, reinterpret_cast<uint8_t*>(&frame), sizeof(frame));
  TEST_ASSERT_TRUE(transport.poll(result));
  TEST_ASSERT_EQUAL(frame.type, result.type);
}
void test_reentrant_completion_and_stop_release_host_state() {
  EspNowTransport transport;
  uint8_t gateway[6] = {2, 0, 0, 0, 0, 9}, key[16] = {1};
  sdkAutoCallback = true;
  TEST_ASSERT_TRUE(transport.begin(1));
  TEST_ASSERT_TRUE(transport.configureHost(gateway, key, key));
  TEST_ASSERT_TRUE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
  TEST_ASSERT_TRUE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
  transport.end();
  TEST_ASSERT_FALSE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
  TEST_ASSERT_TRUE(transport.begin(1));
  TEST_ASSERT_TRUE(transport.configureHost(gateway, key, key));
  TEST_ASSERT_TRUE(transport.sendHost(reinterpret_cast<const uint8_t*>("{}"), 2));
}
void test_control_rx_requires_exact_peer_and_destination_and_bounded_queue() {
  EspNowTransport transport;
  uint8_t gateway[6] = {2, 0, 0, 0, 0, 9}, local[6] = {2, 0, 0, 0, 0, 0}, key[16] = {1};
  uint8_t other[6] = {2, 0, 0, 0, 0, 8}, broadcast[6] = {255,255,255,255,255,255};
  uint8_t packet[128] = {}, result[128] = {}; memcpy(packet, "HDC1", 4);
  TEST_ASSERT_TRUE(transport.begin(1));
  TEST_ASSERT_TRUE(transport.configureHost(gateway, key, key));
  esp_now_recv_info_t info{other, local};
  sdkReceive(&info, packet, sizeof(packet)); TEST_ASSERT_FALSE(transport.pollControl(result));
  info = {gateway, other}; sdkReceive(&info, packet, sizeof(packet));
  TEST_ASSERT_FALSE(transport.pollControl(result));
  info = {gateway, broadcast}; sdkReceive(&info, packet, sizeof(packet));
  TEST_ASSERT_FALSE(transport.pollControl(result));
  info = {gateway, local}; sdkReceive(&info, packet, 127);
  TEST_ASSERT_FALSE(transport.pollControl(result));
  for (int i = 0; i < 10; ++i) sdkReceive(&info, packet, sizeof(packet));
  int count = 0; while (transport.pollControl(result)) ++count;
  TEST_ASSERT_EQUAL(3, count);
  FleetMessage ack{}; ack.version = kFleetProtocolVersion;
  ack.type = uint8_t(FleetMsgType::PlanInstallReceipt); memset(ack.mac, 99, 6);
  info = {other, broadcast}; sdkReceive(&info, reinterpret_cast<uint8_t*>(&ack), sizeof(ack));
  TEST_ASSERT_TRUE(transport.poll(ack)); TEST_ASSERT_EQUAL_MEMORY(other, ack.mac, 6);

  FleetMessage legacy{}; TEST_ASSERT_FALSE(transport.poll(legacy));
  TEST_ASSERT_EQUAL(1, sdkReceiveRegisters);
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_control_rx_requires_exact_peer_and_destination_and_bounded_queue);
  RUN_TEST(test_callback_loss_and_backpressure_do_not_defer_fleet);
  RUN_TEST(test_legacy_unicast_injection_is_not_fleet_input);
  RUN_TEST(test_reentrant_completion_and_stop_release_host_state);
  return UNITY_END();
}
