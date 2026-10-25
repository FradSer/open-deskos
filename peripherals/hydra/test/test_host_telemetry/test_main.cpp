#include <unity.h>

#include <cstring>
#include <limits>

#include "domain/host_telemetry.h"
#include "main_node/app/host_telemetry.h"
using namespace hydra;
void setUp() {}
void tearDown() {}
void test_bounded_honest_frames() {
  char out[251];
  HostTelemetrySession session("0123456789abcdef", "hydra-main-121");
  TEST_ASSERT_TRUE(session.hello(out, sizeof(out), 1200, false));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"clock\":false"));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"seq\":1"));
  EnvMetrics env{};
  TEST_ASSERT_TRUE(session.environment(out, sizeof(out), env, 100));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"valid\":false"));
  TEST_ASSERT_NULL(strstr(out, "\"tc\""));
  NodeStatus node{};
  node.nodeId = 1;
  node.lastSeenMs = 100;
  node.status = PumpStatus::Pulse;
  TEST_ASSERT_TRUE(session.node(out, sizeof(out), node, 10100));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"age\":10000"));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"online\":false"));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"status\":\"PULSE\""));
  TEST_ASSERT_LESS_OR_EQUAL(250, strlen(out));
}

void test_invalid_identity_values_and_full_payload_bounds() {
  char out[251];
  HostTelemetrySession bad("UPPERCASE00000000", "bad\"name");
  TEST_ASSERT_FALSE(bad.hello(out, sizeof(out), 1, true));
  HostTelemetrySession session("0123456789abcdef", "odk-hydra-main-1");
  EnvMetrics env{};
  env.valid = true;
  env.tempC = 100;
  env.humidity = 100;
  env.pressurePa = 130000;
  env.luxValid = true;
  env.lux = 200000;
  env.vpdKpa = 100;
  TEST_ASSERT_TRUE(session.environment(out, sizeof(out), env, 0xffffffff));
  TEST_ASSERT_LESS_OR_EQUAL(250, strlen(out));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"hp\":1300.00"));
  env.tempC = std::numeric_limits<float>::quiet_NaN();
  TEST_ASSERT_TRUE(session.environment(out, sizeof(out), env, 1));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"valid\":false"));
  TEST_ASSERT_NULL(strstr(out, "nan"));
  NodeStatus node{};
  node.nodeId = 1;
  node.online = true;
  node.status = PumpStatus::Watering;
  node.soil.valid = false;
  TEST_ASSERT_TRUE(session.node(out, sizeof(out), node, 1));
  TEST_ASSERT_NOT_NULL(strstr(out, "\"soil\":null"));
  node.nodeId = 7;
  TEST_ASSERT_FALSE(session.node(out, sizeof(out), node, 1));
  TEST_ASSERT_FALSE(session.hello(out, 8, 1, true));
}
void test_batch_pacing_drops_busy_frames_and_keeps_age() {
  HostTelemetryPublisher publisher("0123456789abcdef", "test");
  FleetRoster roster;
  EnvMetrics env{};
  int sends = 0;
  char last[251] = {};
  auto busy = [&](const uint8_t* bytes, size_t size) {
    ++sends;
    memcpy(last, bytes, size);
    last[size] = 0;
    return false;
  };
  publisher.tick(0, env, 0, roster, false, busy);
  publisher.tick(10, env, 0, roster, false, busy);
  TEST_ASSERT_EQUAL(1, sends);
  publisher.tick(25, env, 0, roster, false, busy);
  TEST_ASSERT_EQUAL(2, sends);
  TEST_ASSERT_NOT_NULL(strstr(last, "\"k\":\"env\""));
  publisher.tick(2000, env, 0, roster, false, busy);
  TEST_ASSERT_EQUAL(3, sends);
  TEST_ASSERT_NOT_NULL(strstr(last, "\"k\":\"hello\""));
}
void test_sequence_exhaustion_does_not_wrap() {
  HostTelemetrySession session("0123456789abcdef", "test", 0xfffffffe);
  char out[251];
  TEST_ASSERT_TRUE(session.hello(out, sizeof(out), 0, false));
  TEST_ASSERT_NOT_NULL(strstr(out, "4294967295"));
  TEST_ASSERT_FALSE(session.hello(out, sizeof(out), 0, false));
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_bounded_honest_frames);
  RUN_TEST(test_sequence_exhaustion_does_not_wrap);
  RUN_TEST(test_invalid_identity_values_and_full_payload_bounds);
  RUN_TEST(test_batch_pacing_drops_busy_frames_and_keeps_age);
  return UNITY_END();
}
