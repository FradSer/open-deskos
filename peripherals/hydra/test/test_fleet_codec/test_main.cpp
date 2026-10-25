#include <unity.h>

#include <cstddef>

#include <domain/fleet_codec.h>
#include <domain/timetable.h>
#include <shared/esp_now_transport.h>

using namespace hydra;

// Mirrors features/fleet_message.feature. The builders are the single point where a
// FleetMessage frame is constructed, so the version stamp, type tag, MAC copy, and
// payload placement are host-tested here once for both composition roots.

void setUp() {}
void tearDown() {}

// Scenario: An env broadcast carries the derived metrics and the main node's time.
// Time (hour/minute/month) rides the env frame so sub-nodes without an RTC can still
// gate watering by time-of-day and season; 0xFF means the main node has no valid time.
void test_env_broadcast() {
  FleetMessage m = makeEnvBroadcast(24.5f, 60.0f, 101000.0f, 800.0f, 1.2f, 7, 30, 10);
  TEST_ASSERT_EQUAL_UINT8(kFleetProtocolVersion, m.version);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::EnvBroadcast), m.type);
  TEST_ASSERT_EQUAL_UINT8(0, m.nodeId);
  TEST_ASSERT_EQUAL_FLOAT(24.5f, m.tempC);
  TEST_ASSERT_EQUAL_FLOAT(60.0f, m.humidity);
  TEST_ASSERT_EQUAL_FLOAT(101000.0f, m.pressurePa);
  TEST_ASSERT_EQUAL_FLOAT(800.0f, m.lux);
  TEST_ASSERT_EQUAL_FLOAT(1.2f, m.vpdKpa);
  TEST_ASSERT_EQUAL_UINT8(7, m.hour);
  TEST_ASSERT_EQUAL_UINT8(30, m.minute);
  TEST_ASSERT_EQUAL_UINT8(10, m.month);
}

// An env broadcast with no valid time (RTC unset pre-SNTP) carries the 0xFF marker
// on each time field so sub-nodes ignore the time slice but still accept the env.
void test_env_broadcast_invalid_time() {
  FleetMessage m = makeEnvBroadcast(20.0f, 55.0f, 100000.0f, 600.0f, 0.8f, 0xFF, 0xFF, 0xFF);
  TEST_ASSERT_EQUAL_UINT8(0xFF, m.hour);
  TEST_ASSERT_EQUAL_UINT8(0xFF, m.minute);
  TEST_ASSERT_EQUAL_UINT8(0xFF, m.month);
}

// Scenario: A status report carries soil readings and the reporting node's MAC.
void test_status_report() {
  const uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x01};
  TimetableOutcome outcome{29712345u, 2, static_cast<uint8_t>(EntryRefusal::MinGap), 5, 3};
  FleetMessage m = makeStatusReport(3, mac, 1500, 42.0f, true, 2, 2, 50, 1, 3, outcome);
  TEST_ASSERT_EQUAL_UINT8(kFleetProtocolVersion, m.version);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::StatusReport), m.type);
  TEST_ASSERT_EQUAL_UINT8(3, m.nodeId);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(mac, m.mac, 6);
  TEST_ASSERT_EQUAL_INT32(1500, m.soilRaw);
  TEST_ASSERT_EQUAL_FLOAT(42.0f, m.soilPercent);
  TEST_ASSERT_EQUAL_UINT8(1, m.soilValid);
  TEST_ASSERT_EQUAL_UINT8(2, m.status);
  TEST_ASSERT_EQUAL_UINT8(2, m.pulseCount);
  TEST_ASSERT_EQUAL_UINT8(50, m.effDryPercent);
  TEST_ASSERT_EQUAL_UINT8(1, m.season);
  TEST_ASSERT_EQUAL_UINT32(3, m.fwVersion);
  // The outcome telemetry is appended after every earlier field, so the frame this
  // schema builds stays a valid prefix for a newer one.
  TEST_ASSERT_EQUAL_UINT32(29712345u, m.ttOutcomeWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(2, m.ttOutcomeIndex);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(EntryRefusal::MinGap), m.ttOutcomeCode);
  TEST_ASSERT_EQUAL_UINT8(5, m.ttRanCount);
  TEST_ASSERT_EQUAL_UINT8(3, m.ttRefusedCount);
  // The appended tail is exactly the five outcome fields, 8 packed bytes. If it moves,
  // the frame layout changed and `kFleetProtocolVersion` has to move with it.
  TEST_ASSERT_EQUAL_INT(8, static_cast<int>(sizeof(FleetMessage)) -
                              static_cast<int>(offsetof(FleetMessage, ttOutcomeWindowSeq)));
}

// An invalid soil reading rides as soilValid 0. A status report with no verdict carries a
// zero Window, which is what keeps the main node's outcome topic silent for the zone.
void test_status_report_invalid_soil() {
  const uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x09};
  FleetMessage m = makeStatusReport(1, mac, 0, 0.0f, false, 0, 0, 0, 0, 0);
  TEST_ASSERT_EQUAL_UINT8(0, m.soilValid);
  TEST_ASSERT_EQUAL_UINT32(0, m.ttOutcomeWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttOutcomeCode);
}

// Scenario: A pair request carries the requester id and MAC.
void test_pair_request() {
  const uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x02};
  FleetMessage m = makePairRequest(0, mac);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::PairRequest), m.type);
  TEST_ASSERT_EQUAL_UINT8(0, m.nodeId);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(mac, m.mac, 6);
}

// Scenario: A pair assign carries the new id, subject MAC, and the main node's channel.
void test_pair_assign() {
  const uint8_t mac[6] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x03};
  FleetMessage m = makePairAssign(4, mac, 6);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::PairAssign), m.type);
  TEST_ASSERT_EQUAL_UINT8(4, m.nodeId);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(mac, m.mac, 6);
  TEST_ASSERT_EQUAL_UINT8(6, m.channel);
}

// Scenario: A pump command targets a node and sets the pump flag.
void test_pump_command() {
  FleetMessage m = makePumpCommand(2, true);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::PumpCommand), m.type);
  TEST_ASSERT_EQUAL_UINT8(2, m.nodeId);
  TEST_ASSERT_EQUAL_UINT8(1, m.pumpOn);
}

// Scenario: A spotlight command targets a node and sets the view flag.
void test_view_spotlight() {
  FleetMessage m = makeViewSpotlight(5, false);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::ViewSpotlight), m.type);
  TEST_ASSERT_EQUAL_UINT8(5, m.nodeId);
  TEST_ASSERT_EQUAL_UINT8(0, m.viewOn);
}

// Scenario: Unused payload fields stay zero (the rest of the frame is zero-initialised).
void test_unused_fields_zero() {
  FleetMessage m = makePumpCommand(2, true);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, m.tempC);
  TEST_ASSERT_EQUAL_FLOAT(0.0f, m.vpdKpa);
  TEST_ASSERT_EQUAL_INT32(0, m.soilRaw);
  TEST_ASSERT_EQUAL_UINT8(0, m.viewOn);
  TEST_ASSERT_EQUAL_UINT8(0, m.channel);
  TEST_ASSERT_EQUAL_UINT8(0, m.hour);
  TEST_ASSERT_EQUAL_UINT8(0, m.minute);
  TEST_ASSERT_EQUAL_UINT8(0, m.month);
  TEST_ASSERT_EQUAL_UINT32(0, m.otaVersion);
  TEST_ASSERT_EQUAL_UINT32(0, m.otaBinSize);
  TEST_ASSERT_EQUAL_UINT32(0, m.otaSeq);
  TEST_ASSERT_EQUAL_UINT16(0, m.otaPort);
  // Diagnostic fields stay zero on non-status frames.
  TEST_ASSERT_EQUAL_UINT8(0, m.pulseCount);
  TEST_ASSERT_EQUAL_UINT8(0, m.effDryPercent);
  TEST_ASSERT_EQUAL_UINT8(0, m.season);
  TEST_ASSERT_EQUAL_UINT32(0, m.fwVersion);
  // The v6 outcome telemetry stays zero too.
  TEST_ASSERT_EQUAL_UINT32(0, m.ttOutcomeWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttOutcomeIndex);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttOutcomeCode);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttRanCount);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttRefusedCount);
  const uint8_t zero[6] = {0, 0, 0, 0, 0, 0};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(zero, m.mac, 6);
  const uint8_t zeros[32] = {};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(zeros, m.otaSha256, 32);
  const uint8_t zeroIp[4] = {0, 0, 0, 0};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(zeroIp, m.otaIp, 4);
}

// Forward compatibility: shouldAcceptFrame is the recv gate. A newer-schema main
// (version >= ours) with a larger frame (len >= sizeof) must be accepted so an
// older sub can still receive an OtaAnnounce and self-upgrade over the air.
void test_should_accept_newer_protocol_larger_frame() {
  TEST_ASSERT_TRUE(shouldAcceptFrame(kFleetProtocolVersion + 1,
                                     static_cast<int>(sizeof(FleetMessage)) + 8));
}

void test_should_accept_own_protocol() {
  TEST_ASSERT_TRUE(shouldAcceptFrame(kFleetProtocolVersion,
                                     static_cast<int>(sizeof(FleetMessage))));
}

// An older protocol is rejected: a field this firmware expects may be absent, and
// zero-filling it would guess at a value nobody sent. The forward direction (a newer
// main reaching an older sub) is the one the gate is built for.
void test_should_reject_older_protocol() {
  TEST_ASSERT_FALSE(shouldAcceptFrame(kFleetProtocolVersion - 1,
                                      static_cast<int>(sizeof(FleetMessage))));
}

// A truncated frame is always corruption, never a valid newer frame.
void test_should_reject_truncated() {
  TEST_ASSERT_FALSE(shouldAcceptFrame(kFleetProtocolVersion,
                                      static_cast<int>(sizeof(FleetMessage)) - 1));
}

// Scenario: A timetable frame carries a whole Window.
// ADR-0006 replaced the per-tick Directive with a Window's worth of watering times, so
// the frame grows once, the protocol version bumps with it, and the block is appended
// after every existing field so the prefix stays byte-stable.
void test_timetable_frame_carries_a_window() {
  Timetable t{};
  t.windowSeq = 29712345u;
  t.season = Season::Summer;
  t.count = 2;
  t.entries[0] = TimetableEntry{0, Plan::TopUp, true};
  t.entries[1] = TimetableEntry{150, Plan::Standard, false};

  FleetMessage m = makeTimetableCommand(2, t);

  TEST_ASSERT_EQUAL_UINT8(kFleetProtocolVersion, m.version);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::Timetable), m.type);
  TEST_ASSERT_EQUAL_UINT8(2, m.nodeId);
  TEST_ASSERT_EQUAL_UINT32(29712345u, m.ttWindowSeq);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Summer), m.ttSeason);
  TEST_ASSERT_EQUAL_UINT8(2, m.ttCount);
  TEST_ASSERT_EQUAL_UINT16(0, m.ttEntries[0].offsetMinutes);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::TopUp), m.ttEntries[0].intent);
  TEST_ASSERT_EQUAL_UINT8(1, m.ttEntries[0].night);
  TEST_ASSERT_EQUAL_UINT16(150, m.ttEntries[1].offsetMinutes);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::Standard), m.ttEntries[1].intent);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttEntries[1].night);
}

// Scenario: A timetable entry is an intent, never pulse parameters.
void test_a_timetable_entry_carries_no_dose() {
  // The block's size is exactly the identity, the season, the count and four packed
  // entries. Asserting the size is how "nothing about the dose rides the wire" is
  // checked: a pulse count, a soak time or a threshold would have to appear here. The
  // block ends where the v6 outcome telemetry begins.
  TEST_ASSERT_EQUAL_INT(22, static_cast<int>(offsetof(FleetMessage, ttOutcomeWindowSeq)) -
                              static_cast<int>(offsetof(FleetMessage, ttWindowSeq)));
  TEST_ASSERT_TRUE(sizeof(FleetMessage) <= 250);
}

// Scenario: A timetable with no entries is a frame that exists.
void test_an_empty_timetable_is_a_frame_that_exists() {
  Timetable t{};
  t.windowSeq = 7;
  t.season = Season::Autumn;
  t.count = 0;

  FleetMessage m = makeTimetableCommand(1, t);
  Timetable decoded{};

  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(FleetMsgType::Timetable), m.type);
  TEST_ASSERT_EQUAL_UINT8(0, m.ttCount);
  // "Water nothing this Window" is a real Window. It decodes successfully, which is what
  // keeps it apart from "no frame arrived" -- the two mean opposite things.
  TEST_ASSERT_TRUE(decodeTimetable(m, 1, decoded));
  TEST_ASSERT_EQUAL_UINT8(0, decoded.count);
  TEST_ASSERT_EQUAL_UINT32(7u, decoded.windowSeq);
}

// Scenario: A released message kind is not reused.
void test_a_released_message_kind_is_not_reused() {
  TEST_ASSERT_EQUAL_UINT8(10, static_cast<uint8_t>(FleetMsgType::PlanCommand));
  TEST_ASSERT_EQUAL_UINT8(11, static_cast<uint8_t>(FleetMsgType::Timetable));
  TEST_ASSERT_TRUE(FleetMsgType::Timetable != FleetMsgType::PlanCommand);
}

// Scenario: A timetable for another node is not decoded.
void test_a_timetable_for_another_node_is_not_decoded() {
  Timetable t{};
  t.windowSeq = 7;
  t.season = Season::Summer;
  FleetMessage m = makeTimetableCommand(2, t);
  Timetable decoded{};

  TEST_ASSERT_FALSE(decodeTimetable(m, 3, decoded));
  TEST_ASSERT_TRUE(decodeTimetable(m, 2, decoded));
}

// Scenario: A timetable arriving at an unprovisioned node is not decoded.
void test_a_timetable_at_an_unprovisioned_node_is_not_decoded() {
  Timetable t{};
  t.windowSeq = 7;
  t.season = Season::Summer;
  FleetMessage m = makeTimetableCommand(1, t);
  Timetable decoded{};

  TEST_ASSERT_FALSE(decodeTimetable(m, 0, decoded));
}

// Scenario: A timetable with an unusable byte is not decoded.
void test_a_timetable_with_an_unusable_byte_is_not_decoded() {
  Timetable t{};
  t.windowSeq = 7;
  t.season = Season::Summer;
  t.count = 1;
  t.entries[0] = TimetableEntry{10, Plan::TopUp, false};

  FleetMessage m = makeTimetableCommand(1, t);
  Timetable decoded{};

  // A season this firmware cannot name is not a table it can execute.
  FleetMessage badSeason = m;
  badSeason.ttSeason = 9;
  TEST_ASSERT_FALSE(decodeTimetable(badSeason, 1, decoded));

  // Nor is an intent that does not water: holding is zero entries, releasing is no
  // frame, and neither belongs in the entry vocabulary.
  FleetMessage badIntent = m;
  badIntent.ttEntries[0].intent = static_cast<uint8_t>(Plan::Hold);
  TEST_ASSERT_FALSE(decodeTimetable(badIntent, 1, decoded));

  FleetMessage tooMany = m;
  tooMany.ttCount = kMaxTimetableEntries + 1;
  TEST_ASSERT_FALSE(decodeTimetable(tooMany, 1, decoded));
}

// Scenario: A malformed timetable is not decoded rather than partly used.
void test_a_malformed_timetable_is_not_decoded() {
  Timetable t{};
  t.windowSeq = 7;
  t.season = Season::Summer;
  t.count = 2;
  t.entries[0] = TimetableEntry{150, Plan::TopUp, false};
  t.entries[1] = TimetableEntry{10, Plan::Standard, false};

  FleetMessage m = makeTimetableCommand(1, t);
  Timetable decoded{};

  // Offsets that do not increase are rejected whole: choosing which entries survive
  // would be an edit to a judgment the model did not make.
  TEST_ASSERT_FALSE(decodeTimetable(m, 1, decoded));
}

// Scenario: The builder refuses a malformed Timetable.
void test_the_builder_refuses_a_malformed_timetable() {
  Timetable t{};
  t.windowSeq = 7;
  t.season = Season::Summer;
  t.count = 1;
  t.entries[0] = TimetableEntry{kWindowMinutes, Plan::TopUp, false};  // outside the Window

  FleetMessage m = makeTimetableCommand(1, t);

  TEST_ASSERT_EQUAL_UINT8(0, m.type);  // nothing is constructed
}

void test_plan_install_receipt_keeps_layout_and_does_not_claim_execution() {
  Timetable plan; plan.windowSeq = 22; plan.count = 1;
  plan.entries[0] = {12, Plan::Standard, true};
  uint8_t mac[6] = {2,1,2,3,4,5};
  FleetMessage ack = makePlanInstallReceipt(2, mac, plan, true);
  TEST_ASSERT_EQUAL(6, ack.version); TEST_ASSERT_EQUAL(12, ack.type);
  TEST_ASSERT_EQUAL(229, sizeof(ack));
  TEST_ASSERT_EQUAL_MEMORY(mac, ack.mac, 6); TEST_ASSERT_EQUAL(0, ack.status);
  TEST_ASSERT_EQUAL(0, ack.ssid[0]); TEST_ASSERT_EQUAL(0, ack.psk[0]);
  Timetable decoded; TEST_ASSERT_TRUE(decodePlanInstallReceipt(ack, 2, decoded));
  TEST_ASSERT_TRUE(sameTimetable(plan, decoded));
  TEST_ASSERT_FALSE(decodePlanInstallReceipt(ack, 1, decoded));
  ack.pumpOn = 2; TEST_ASSERT_FALSE(decodePlanInstallReceipt(ack, 2, decoded));
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_plan_install_receipt_keeps_layout_and_does_not_claim_execution);
  RUN_TEST(test_env_broadcast);
  RUN_TEST(test_env_broadcast_invalid_time);
  RUN_TEST(test_status_report);
  RUN_TEST(test_status_report_invalid_soil);
  RUN_TEST(test_pair_request);
  RUN_TEST(test_pair_assign);
  RUN_TEST(test_pump_command);
  RUN_TEST(test_view_spotlight);
  RUN_TEST(test_unused_fields_zero);
  RUN_TEST(test_should_accept_newer_protocol_larger_frame);
  RUN_TEST(test_should_accept_own_protocol);
  RUN_TEST(test_should_reject_older_protocol);
  RUN_TEST(test_should_reject_truncated);
  RUN_TEST(test_timetable_frame_carries_a_window);
  RUN_TEST(test_a_timetable_entry_carries_no_dose);
  RUN_TEST(test_an_empty_timetable_is_a_frame_that_exists);
  RUN_TEST(test_a_released_message_kind_is_not_reused);
  RUN_TEST(test_a_timetable_for_another_node_is_not_decoded);
  RUN_TEST(test_a_timetable_at_an_unprovisioned_node_is_not_decoded);
  RUN_TEST(test_a_timetable_with_an_unusable_byte_is_not_decoded);
  RUN_TEST(test_a_malformed_timetable_is_not_decoded);
  RUN_TEST(test_the_builder_refuses_a_malformed_timetable);
  return UNITY_END();
}
