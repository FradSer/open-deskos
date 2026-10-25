#include <unity.h>

#include <cstring>

#include <domain/fleet_codec.h>
#include <main_node/app/fleet_roster.h>

using namespace hydra;

// Mirrors the roster scenarios in features/fleet_status.feature (status, offline)
// and the identity scenarios in features/fleet_pairing.feature (assign, idempotent,
// no-reuse, persistence round-trip). FleetRoster is pure, so these run on the host.

namespace {
constexpr uint32_t kNow = 1000000U;

FleetMessage statusMsg(const uint8_t mac[6], uint8_t id, float soilPct, PumpStatus status) {
  FleetMessage m{};
  m.version = kFleetProtocolVersion;
  m.type = static_cast<uint8_t>(FleetMsgType::StatusReport);
  m.nodeId = id;
  memcpy(m.mac, mac, 6);
  m.soilRaw = 1800;
  m.soilPercent = soilPct;
  m.soilValid = 1;
  m.status = static_cast<uint8_t>(status);
  // Diagnostic slice defaults (an unupgraded v2 sub-node leaves these 0).
  m.pulseCount = 0;
  m.effDryPercent = 0;
  m.season = 0;
  m.fwVersion = 0;
  return m;
}
}  // namespace

void setUp() {}
void tearDown() {}

// Scenario: A status report registers a sub-node and its readings
void test_status_registers_node() {
  FleetRoster r;
  uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03};
  r.applyStatus(statusMsg(mac, 7, 42.0f, PumpStatus::Pulse), kNow);

  TEST_ASSERT_EQUAL_INT(1, r.count());
  TEST_ASSERT_EQUAL_INT(7, r.at(0).nodeId);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 42.0f, r.at(0).soil.percent);
  TEST_ASSERT_TRUE(r.at(0).soil.valid);
  TEST_ASSERT_TRUE(r.at(0).status == PumpStatus::Pulse);
  TEST_ASSERT_TRUE(r.at(0).online);
}

// A second report from the same node updates it in place, not as a new node.
void test_status_updates_in_place() {
  FleetRoster r;
  uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03};
  r.applyStatus(statusMsg(mac, 7, 42.0f, PumpStatus::Pulse), kNow);
  r.applyStatus(statusMsg(mac, 7, 55.0f, PumpStatus::Idle), kNow + 2000);

  TEST_ASSERT_EQUAL_INT(1, r.count());
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 55.0f, r.at(0).soil.percent);
  TEST_ASSERT_TRUE(r.at(0).status == PumpStatus::Idle);
}

// Scenario: a status report carries the diagnostic slice (pulse/effdry/season/ver)
// onto NodeStatus, so the main node can forward them to MQTT.
void test_status_carries_diagnostic_fields() {
  FleetRoster r;
  uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03};
  FleetMessage m = statusMsg(mac, 7, 42.0f, PumpStatus::Pulse);
  m.pulseCount = 2;
  m.effDryPercent = 50;
  m.season = 1;  // Summer
  m.fwVersion = 3;
  r.applyStatus(m, kNow);

  TEST_ASSERT_EQUAL_UINT8(2, r.at(0).pulseCount);
  TEST_ASSERT_EQUAL_UINT8(50, r.at(0).effDryPercent);
  TEST_ASSERT_EQUAL_UINT8(1, r.at(0).season);
  TEST_ASSERT_EQUAL_UINT32(3, r.at(0).fwVersion);
}

// Scenario: A sub-node goes offline after the timeout
void test_node_goes_offline_after_timeout() {
  FleetRoster r;
  uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03};
  r.applyStatus(statusMsg(mac, 1, 50.0f, PumpStatus::Idle), kNow);
  TEST_ASSERT_TRUE(r.at(0).online);

  r.tick(kNow + 9000, 8000);  // last seen 9s ago, timeout 8s
  TEST_ASSERT_FALSE(r.at(0).online);
}

// A node still within the timeout stays online.
void test_node_stays_online_within_timeout() {
  FleetRoster r;
  uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03};
  r.applyStatus(statusMsg(mac, 1, 50.0f, PumpStatus::Idle), kNow);
  r.tick(kNow + 5000, 8000);
  TEST_ASSERT_TRUE(r.at(0).online);
}

// Scenario: pairing assigns a fixed id; re-pairing the same MAC keeps the same id
void test_assign_is_idempotent_per_mac() {
  FleetRoster r;
  uint8_t macA[6] = {0x10, 0, 0, 0, 0, 0x01};
  uint8_t id1 = r.assign(macA, kNow);
  uint8_t id2 = r.assign(macA, kNow + 1000);
  TEST_ASSERT_EQUAL_INT(id1, id2);
  TEST_ASSERT_EQUAL_INT(1, r.count());
}

// Scenario: ids are sequential (max + 1) and not reused
void test_assign_gives_sequential_ids() {
  FleetRoster r;
  uint8_t macA[6] = {0x10, 0, 0, 0, 0, 0x01};
  uint8_t macB[6] = {0x10, 0, 0, 0, 0, 0x02};
  uint8_t macC[6] = {0x10, 0, 0, 0, 0, 0x03};
  TEST_ASSERT_EQUAL_INT(1, r.assign(macA, kNow));
  TEST_ASSERT_EQUAL_INT(2, r.assign(macB, kNow));
  TEST_ASSERT_EQUAL_INT(3, r.assign(macC, kNow));
}

// Scenario: roster survives a reboot (serialize -> NVS -> deserialize)
void test_serialize_round_trip() {
  FleetRoster r;
  uint8_t macA[6] = {0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01};
  uint8_t macB[6] = {0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x02};
  r.assign(macA, kNow);
  r.assign(macB, kNow);

  uint8_t buf[FleetRoster::kBlobSize];
  int n = r.serialize(buf, sizeof(buf));
  TEST_ASSERT_TRUE(n > 0);

  FleetRoster restored;
  restored.deserialize(buf, n);
  TEST_ASSERT_EQUAL_INT(2, restored.count());
  TEST_ASSERT_EQUAL_INT(1, restored.at(0).nodeId);
  TEST_ASSERT_EQUAL_INT(2, restored.at(1).nodeId);
  TEST_ASSERT_EQUAL_INT(0, memcmp(restored.at(0).mac, macA, 6));
  TEST_ASSERT_EQUAL_INT(0, memcmp(restored.at(1).mac, macB, 6));

  // A device known from NVS but not yet heard from is offline until it reports.
  TEST_ASSERT_FALSE(restored.at(0).online);

  // Re-pairing after restore keeps the persisted id.
  TEST_ASSERT_EQUAL_INT(1, restored.assign(macA, kNow));
}

// Scenario: The v6 outcome telemetry round-trips from the builder through the wire layout
// onto NodeStatus, where the main node's MQTT publisher reads it back.
void test_status_carries_timetable_outcome() {
  FleetRoster r;
  uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0x01, 0x02, 0x03};
  TimetableOutcome outcome{29836800u, 2, static_cast<uint8_t>(EntryRefusal::MinGap), 3, 1};
  FleetMessage m =
      makeStatusReport(7, mac, 1800, 42.0f, true, static_cast<uint8_t>(PumpStatus::Pulse), 0,
                       50, 1, 6, outcome);
  r.applyStatus(m, kNow);

  TEST_ASSERT_EQUAL_UINT32(29836800u, r.at(0).ttOutcomeWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(2, r.at(0).ttOutcomeIndex);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EntryRefusal::MinGap), r.at(0).ttOutcomeCode);
  TEST_ASSERT_EQUAL_UINT8(3, r.at(0).ttRanCount);
  TEST_ASSERT_EQUAL_UINT8(1, r.at(0).ttRefusedCount);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_status_registers_node);
  RUN_TEST(test_status_updates_in_place);
  RUN_TEST(test_status_carries_diagnostic_fields);
  RUN_TEST(test_node_goes_offline_after_timeout);
  RUN_TEST(test_node_stays_online_within_timeout);
  RUN_TEST(test_assign_is_idempotent_per_mac);
  RUN_TEST(test_assign_gives_sequential_ids);
  RUN_TEST(test_serialize_round_trip);
  RUN_TEST(test_status_carries_timetable_outcome);
  return UNITY_END();
}
