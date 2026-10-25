#include <unity.h>

#include "shared/host_tx_gate.h"
using namespace hydra;
void setUp() {}
void tearDown() {}
void test_missing_host_callback_never_blocks_fleet() {
  HostTxGate gate;
  TEST_ASSERT_TRUE(gate.hostStart(100));
  TEST_ASSERT_FALSE(gate.hostStart(599));
  TEST_ASSERT_FALSE(gate.hostStart(600));
  gate.hostComplete();
  TEST_ASSERT_FALSE(gate.hostStart(601));
  // Fleet sends do not consult hostStart; callbacks remain safe after failure.
  gate.fleetStart();
  gate.fleetComplete();
  gate.fleetComplete();
  gate.reset();
  TEST_ASSERT_TRUE(gate.hostStart(1000));
}
void test_fleet_priority_and_reentrant_callbacks() {
  HostTxGate gate;
  gate.fleetStart();
  gate.fleetStart();
  TEST_ASSERT_FALSE(gate.hostStart(0));
  gate.fleetComplete();
  TEST_ASSERT_FALSE(gate.hostStart(1));
  gate.fleetComplete();
  TEST_ASSERT_TRUE(gate.hostStart(2));
  gate.hostComplete();
  TEST_ASSERT_TRUE(gate.hostStart(3));
  gate.hostRejected();
  TEST_ASSERT_TRUE(gate.hostStart(4));
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_missing_host_callback_never_blocks_fleet);
  RUN_TEST(test_fleet_priority_and_reentrant_callbacks);
  return UNITY_END();
}
