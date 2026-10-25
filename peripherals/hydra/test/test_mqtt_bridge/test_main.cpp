#include <unity.h>

#include <cstring>

#include <main_node/app/mqtt_bridge.h>
#include <main_node/hal/main_clock.h>

using namespace hydra;

// Mirrors features/homekit_mqtt.feature: env topic/format mapping, the per-node
// MQTT-force state machine (latch / keep-alive / release / safety auto-release),
// and change-detection for the retained pump/online topics. All pure, host-run.

namespace {
constexpr uint32_t kRefreshMs = 250;
constexpr uint32_t kMaxForceMs = 60000;
constexpr uint32_t kNow = 5000000U;

EnvReading reading(float t, float h, float pPa, float lux, bool valid, bool luxValid) {
  return EnvReading{t, h, pPa, lux, valid, luxValid};
}

EnvMetrics metrics(float t, float h, float pPa, float lux, float vpd, bool valid, bool luxValid) {
  return EnvMetrics{t, h, pPa, lux, vpd, valid, luxValid};
}

// The broadcast time slice the main node would publish alongside the metrics.
EnvTimeSnapshot trustedTime() { return EnvTimeSnapshot{13, 45, 9}; }

EnvTimeSnapshot untrustedTime() {
  return EnvTimeSnapshot{EnvTimeSnapshot::kInvalid, EnvTimeSnapshot::kInvalid,
                         EnvTimeSnapshot::kInvalid};
}

const MqttPayload* findTopic(const MqttPayload* p, int n, const char* topic) {
  for (int i = 0; i < n; i++) {
    if (strcmp(p[i].topic, topic) == 0) return &p[i];
  }
  return nullptr;
}
}  // namespace

void setUp() {}
void tearDown() {}

// Scenario: A valid environment reading publishes the sensor topics
void test_env_payloads_topics_and_format() {
  MqttPayload p[4];
  int n = buildEnvPayloads(reading(24.5f, 61.2f, 100260.0f, 1234.0f, true, true), p);

  TEST_ASSERT_EQUAL_INT(4, n);
  const MqttPayload* t = findTopic(p, n, "hydra/main/temp");
  TEST_ASSERT_NOT_NULL(t);
  TEST_ASSERT_EQUAL_STRING("24.5", t->value);
  t = findTopic(p, n, "hydra/main/humidity");
  TEST_ASSERT_NOT_NULL(t);
  TEST_ASSERT_EQUAL_STRING("61.2", t->value);
  t = findTopic(p, n, "hydra/main/pressure");
  TEST_ASSERT_NOT_NULL(t);
  TEST_ASSERT_EQUAL_STRING("1002.6", t->value);
  t = findTopic(p, n, "hydra/main/lux");
  TEST_ASSERT_NOT_NULL(t);
  TEST_ASSERT_EQUAL_STRING("1234.0", t->value);
}

// Scenario: An invalid environment reading publishes nothing
void test_env_invalid_publishes_nothing() {
  MqttPayload p[4];
  TEST_ASSERT_EQUAL_INT(0, buildEnvPayloads(reading(0, 0, 0, 0, false, true), p));
}

// Scenario: A reading without lux skips only the lux topic
void test_env_without_lux_skips_lux() {
  MqttPayload p[4];
  int n = buildEnvPayloads(reading(20.0f, 50.0f, 101325.0f, 0.0f, true, false), p);
  TEST_ASSERT_EQUAL_INT(3, n);
  TEST_ASSERT_NULL(findTopic(p, n, "hydra/main/lux"));
}

// Scenario: Zero lux is clamped to the HomeKit minimum
void test_env_lux_clamped_to_homekit_minimum() {
  MqttPayload p[4];
  int n = buildEnvPayloads(reading(20.0f, 50.0f, 101325.0f, 0.0f, true, true), p);
  const MqttPayload* t = findTopic(p, n, "hydra/main/lux");
  TEST_ASSERT_NOT_NULL(t);
  TEST_ASSERT_EQUAL_STRING("0.0001", t->value);
}

// Topic parsing: only hydra/node<N>/pump/set is a command.
void test_parse_pump_set_topic() {
  TEST_ASSERT_EQUAL_UINT8(3, parsePumpSetTopic("hydra/node3/pump/set"));
  TEST_ASSERT_EQUAL_UINT8(12, parsePumpSetTopic("hydra/node12/pump/set"));
  TEST_ASSERT_EQUAL_UINT8(0, parsePumpSetTopic("hydra/node3/pump"));
  TEST_ASSERT_EQUAL_UINT8(0, parsePumpSetTopic("hydra/main/temp"));
  TEST_ASSERT_EQUAL_UINT8(0, parsePumpSetTopic("hydra/node0/pump/set"));
  TEST_ASSERT_EQUAL_UINT8(0, parsePumpSetTopic("hydra/nodeX/pump/set"));
  TEST_ASSERT_EQUAL_UINT8(0, parsePumpSetTopic("hydra/node3x/pump/set"));
}

void test_parse_on_off_payloads() {
  TEST_ASSERT_TRUE(parseOnOff("true"));
  TEST_ASSERT_TRUE(parseOnOff("True"));
  TEST_ASSERT_TRUE(parseOnOff("ON"));
  TEST_ASSERT_TRUE(parseOnOff("1"));
  TEST_ASSERT_FALSE(parseOnOff("false"));
  TEST_ASSERT_FALSE(parseOnOff("0"));
  TEST_ASSERT_FALSE(parseOnOff(""));
  TEST_ASSERT_FALSE(parseOnOff("offish"));
}

void test_node_topic_builder() {
  char buf[24];
  buildNodeTopic(3, "pump", buf, sizeof(buf));
  TEST_ASSERT_EQUAL_STRING("hydra/node3/pump", buf);
  buildNodeTopic(6, "online", buf, sizeof(buf));
  TEST_ASSERT_EQUAL_STRING("hydra/node6/online", buf);
}

NodeStatus nodeStatus(float soilPercent, bool soilValid, PumpStatus status, bool online) {
  NodeStatus node{};
  node.nodeId = 2;
  node.soil = SoilReading{0, soilPercent, soilValid};
  node.status = status;
  node.online = online;
  node.pulseCount = 3;
  node.effDryPercent = 52;
  node.season = 1;
  node.fwVersion = 7;
  return node;
}

// Scenario: A HomeKit switch turning on forces watering on that node
void test_set_on_latches_force_and_emits_command() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  auto cmd = b.onSetMessage("hydra/node3/pump/set", "true", kNow);

  TEST_ASSERT_TRUE(cmd.valid);
  TEST_ASSERT_EQUAL_UINT8(3, cmd.nodeId);
  TEST_ASSERT_TRUE(cmd.on);
}

// Scenario: The forced node is re-commanded while the switch stays on
void test_keep_alive_resends_on_interval() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  b.onSetMessage("hydra/node3/pump/set", "true", kNow);

  TEST_ASSERT_FALSE(b.tick(kNow + kRefreshMs - 1).valid);  // not due yet
  auto cmd = b.tick(kNow + kRefreshMs);
  TEST_ASSERT_TRUE(cmd.valid);
  TEST_ASSERT_EQUAL_UINT8(3, cmd.nodeId);
  TEST_ASSERT_TRUE(cmd.on);
  TEST_ASSERT_FALSE(b.tick(kNow + kRefreshMs).valid);  // sent: not due again
}

// Scenario: A HomeKit switch turning off releases the force
void test_set_off_releases_force() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  b.onSetMessage("hydra/node3/pump/set", "true", kNow);
  auto cmd = b.onSetMessage("hydra/node3/pump/set", "false", kNow + 1000);

  TEST_ASSERT_TRUE(cmd.valid);
  TEST_ASSERT_FALSE(cmd.on);
  TEST_ASSERT_FALSE(b.tick(kNow + 2000).valid);  // no more keep-alives
}

// Scenario: A switch left on auto-releases after the safety limit
void test_force_auto_releases_after_safety_cap() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  b.onSetMessage("hydra/node3/pump/set", "true", kNow);

  auto cmd = b.tick(kNow + kMaxForceMs);
  TEST_ASSERT_TRUE(cmd.valid);
  TEST_ASSERT_EQUAL_UINT8(3, cmd.nodeId);
  TEST_ASSERT_FALSE(cmd.on);  // the release command
  TEST_ASSERT_FALSE(b.tick(kNow + kMaxForceMs + kRefreshMs).valid);
}

// Two nodes forced at once each get their own keep-alive.
void test_two_forced_nodes_both_keep_alive() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  b.onSetMessage("hydra/node1/pump/set", "true", kNow);
  b.onSetMessage("hydra/node2/pump/set", "true", kNow);

  auto a = b.tick(kNow + kRefreshMs);
  auto c = b.tick(kNow + kRefreshMs);
  TEST_ASSERT_TRUE(a.valid);
  TEST_ASSERT_TRUE(c.valid);
  TEST_ASSERT_TRUE((a.nodeId == 1 && c.nodeId == 2) || (a.nodeId == 2 && c.nodeId == 1));
  TEST_ASSERT_FALSE(b.tick(kNow + kRefreshMs).valid);
}

// Scenario: Malformed set topics and payloads are ignored
void test_malformed_topic_ignored() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  TEST_ASSERT_FALSE(b.onSetMessage("hydra/main/temp", "true", kNow).valid);
  TEST_ASSERT_FALSE(b.onSetMessage("hydra/node3/pump", "true", kNow).valid);
}

// Scenario: An invalid pump payload does not release an active force.
void test_invalid_payload_does_not_release_active_force() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  b.onSetMessage("hydra/node3/pump/set", "true", kNow);

  TEST_ASSERT_FALSE(b.onSetMessage("hydra/node3/pump/set", "banana", kNow + 100).valid);
  auto cmd = b.tick(kNow + kRefreshMs);
  TEST_ASSERT_TRUE(cmd.valid);
  TEST_ASSERT_EQUAL_UINT8(3, cmd.nodeId);
  TEST_ASSERT_TRUE(cmd.on);
}

// Scenario: Explicit off payloads release an active force.
void test_off_payloads_release_active_force() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  b.onSetMessage("hydra/node3/pump/set", "true", kNow);
  auto off = b.onSetMessage("hydra/node3/pump/set", "off", kNow + 100);
  TEST_ASSERT_TRUE(off.valid);
  TEST_ASSERT_FALSE(off.on);

  b.onSetMessage("hydra/node3/pump/set", "true", kNow + 200);
  off = b.onSetMessage("hydra/node3/pump/set", "0", kNow + 300);
  TEST_ASSERT_TRUE(off.valid);
  TEST_ASSERT_FALSE(off.on);
}

// Scenario: A full bridge does not emit an untracked force command.
void test_full_bridge_rejects_untracked_command() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  char topic[32];
  for (uint8_t id = 1; id <= MqttFleetBridge::kMaxNodes; id++) {
    snprintf(topic, sizeof(topic), "hydra/node%u/pump/set", id);
    TEST_ASSERT_TRUE(b.onSetMessage(topic, "true", kNow + id).valid);
  }
  TEST_ASSERT_FALSE(b.onSetMessage("hydra/node7/pump/set", "true", kNow).valid);
}

// Scenario: The pump topic publishes only when the watering state changes
void test_pump_change_detection() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  TEST_ASSERT_TRUE(b.pumpChanged(2, false));   // first sighting seeds the broker
  TEST_ASSERT_FALSE(b.pumpChanged(2, false));  // repeat report: no publish
  TEST_ASSERT_TRUE(b.pumpChanged(2, true));    // Watering: publish on
  TEST_ASSERT_FALSE(b.pumpChanged(2, true));
}

// Scenario: The online topic publishes only on transitions
void test_online_change_detection() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  TEST_ASSERT_TRUE(b.onlineChanged(2, true));
  TEST_ASSERT_FALSE(b.onlineChanged(2, true));
  TEST_ASSERT_TRUE(b.onlineChanged(2, false));
}

// Scenario: The operating status label publishes on every transition (incl. 0)
void test_status_change_detection() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  TEST_ASSERT_TRUE(b.statusChanged(2, static_cast<uint8_t>(PumpStatus::Idle)));  // seeds
  TEST_ASSERT_FALSE(b.statusChanged(2, static_cast<uint8_t>(PumpStatus::Idle)));
  TEST_ASSERT_TRUE(b.statusChanged(2, static_cast<uint8_t>(PumpStatus::Pulse)));
  TEST_ASSERT_TRUE(b.statusChanged(2, static_cast<uint8_t>(PumpStatus::Soak)));
  TEST_ASSERT_TRUE(b.statusChanged(2, static_cast<uint8_t>(PumpStatus::Fault)));
}

// Scenario: pulse/effdry/season/ver publish on change, including a first 0
void test_diagnostic_change_detection() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  // First report with value 0 still publishes (seeds the broker).
  TEST_ASSERT_TRUE(b.pulseChanged(2, 0));
  TEST_ASSERT_FALSE(b.pulseChanged(2, 0));
  TEST_ASSERT_TRUE(b.pulseChanged(2, 1));
  TEST_ASSERT_TRUE(b.pulseChanged(2, 2));

  TEST_ASSERT_TRUE(b.effDryChanged(2, 50));
  TEST_ASSERT_FALSE(b.effDryChanged(2, 50));
  TEST_ASSERT_TRUE(b.effDryChanged(2, 45));

  TEST_ASSERT_TRUE(b.seasonChanged(2, 1));  // Summer
  TEST_ASSERT_FALSE(b.seasonChanged(2, 1));

  TEST_ASSERT_TRUE(b.versionChanged(2, 3));
  TEST_ASSERT_FALSE(b.versionChanged(2, 3));
  TEST_ASSERT_TRUE(b.versionChanged(2, 4));
}

// Scenario: An environment snapshot includes sensor values and main availability.
void test_environment_snapshot_includes_availability() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  int n = b.buildEnvironmentSnapshot(metrics(24.5f, 61.2f, 100260.0f, 1234.0f,
                                              1.26f, true, true), trustedTime(), payloads);

  TEST_ASSERT_EQUAL_INT(7, n);
  const MqttPayload* online = findTopic(payloads, n, "hydra/main/online");
  TEST_ASSERT_NOT_NULL(online);
  TEST_ASSERT_EQUAL_STRING("true", online->value);
  const MqttPayload* vpd = findTopic(payloads, n, "hydra/main/vpd");
  TEST_ASSERT_NOT_NULL(vpd);
  TEST_ASSERT_EQUAL_STRING("1.26", vpd->value);
  const MqttPayload* env = findTopic(payloads, n, "hydra/main/env");
  TEST_ASSERT_NOT_NULL(env);
  TEST_ASSERT_EQUAL_STRING("v=1;l=1;t=24.5;h=61.2;p=1002.6;x=1234.0;d=1.26;hh=13;mm=45",
                           env->value);
}

// Scenario: An untrustworthy main clock is visible on the snapshot.
void test_snapshot_reports_untrustworthy_clock() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  int n = b.buildEnvironmentSnapshot(metrics(24.5f, 61.2f, 100260.0f, 1234.0f,
                                              1.26f, true, true), untrustedTime(),
                                      payloads);

  const MqttPayload* env = findTopic(payloads, n, "hydra/main/env");
  TEST_ASSERT_NOT_NULL(env);
  TEST_ASSERT_EQUAL_STRING("v=1;l=1;t=24.5;h=61.2;p=1002.6;x=1234.0;d=1.26;hh=NC;mm=NC",
                           env->value);
}

// Scenario: An invalid-light snapshot remains complete.
void test_snapshot_preserves_core_metrics_when_lux_is_invalid() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  int n = b.buildEnvironmentSnapshot(metrics(24.5f, 61.2f, 100260.0f, 0.0f,
                                              1.26f, true, false), trustedTime(), payloads);

  TEST_ASSERT_EQUAL_INT(6, n);
  const MqttPayload* env = findTopic(payloads, n, "hydra/main/env");
  TEST_ASSERT_NOT_NULL(env);
  TEST_ASSERT_EQUAL_STRING("v=1;l=0;t=24.5;h=61.2;p=1002.6;x=0.0000;d=1.26;hh=13;mm=45",
                           env->value);
}

// Scenario: An invalid environment reading clears retained VPD authority.
void test_invalid_environment_snapshot_marks_vpd_nc() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  int n = b.buildEnvironmentSnapshot(metrics(0.0f, 0.0f, 0.0f, 0.0f,
                                              0.0f, false, false), trustedTime(), payloads);

  TEST_ASSERT_EQUAL_INT(3, n);
  const MqttPayload* vpd = findTopic(payloads, n, "hydra/main/vpd");
  TEST_ASSERT_NOT_NULL(vpd);
  TEST_ASSERT_EQUAL_STRING("NC", vpd->value);
  const MqttPayload* env = findTopic(payloads, n, "hydra/main/env");
  TEST_ASSERT_NOT_NULL(env);
  TEST_ASSERT_EQUAL_STRING("v=0", env->value);
  const MqttPayload* online = findTopic(payloads, n, "hydra/main/online");
  TEST_ASSERT_NOT_NULL(online);
  TEST_ASSERT_EQUAL_STRING("true", online->value);
}

// Scenario: A node snapshot publishes its initial state and diagnostics.
void test_first_node_snapshot_contains_all_semantic_payloads() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  int n = b.buildNodeSnapshot(nodeStatus(42.0f, true, PumpStatus::Soak, true), payloads);

  TEST_ASSERT_EQUAL_INT(8, n);
  const MqttPayload* payload = findTopic(payloads, n, "hydra/node2/pump");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("false", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/online");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("true", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/soil");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("42.0", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/status");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("SOAK", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/pulse");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("3", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/effdry");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("52", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/season");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("1", payload->value);
  payload = findTopic(payloads, n, "hydra/node2/ver");
  TEST_ASSERT_NOT_NULL(payload);
  TEST_ASSERT_EQUAL_STRING("7", payload->value);

  TEST_ASSERT_EQUAL_INT(0, b.buildNodeSnapshot(nodeStatus(42.0f, true, PumpStatus::Soak, true),
                                                payloads));
}

// Scenario: A node snapshot reports a disconnected soil probe as NC.
void test_node_snapshot_publishes_nc_on_soil_invalid_transition() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  b.buildNodeSnapshot(nodeStatus(42.0f, true, PumpStatus::Idle, true), payloads);

  int n = b.buildNodeSnapshot(nodeStatus(0.0f, false, PumpStatus::Idle, true), payloads);
  TEST_ASSERT_EQUAL_INT(1, n);
  TEST_ASSERT_EQUAL_STRING("hydra/node2/soil", payloads[0].topic);
  TEST_ASSERT_EQUAL_STRING("NC", payloads[0].value);
}

// Scenario: The periodic node heartbeat refreshes the complete retained snapshot.
void test_node_heartbeat_republishes_unchanged_snapshot() {
  TEST_ASSERT_FALSE(isNodeMqttHeartbeatDue(kNow + 59999U, kNow, 60000U));
  TEST_ASSERT_TRUE(isNodeMqttHeartbeatDue(kNow + 60000U, kNow, 60000U));

  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payloads[MqttFleetBridge::kMaxSnapshotPayloads];
  NodeStatus node = nodeStatus(42.0f, true, PumpStatus::Soak, true);
  b.buildNodeSnapshot(node, payloads);
  TEST_ASSERT_EQUAL_INT(0, b.buildNodeSnapshot(node, payloads));

  int n = b.buildNodeSnapshot(node, payloads, true);
  TEST_ASSERT_EQUAL_INT(8, n);
  TEST_ASSERT_NOT_NULL(findTopic(payloads, n, "hydra/node2/pump"));
  TEST_ASSERT_NOT_NULL(findTopic(payloads, n, "hydra/node2/online"));
  TEST_ASSERT_NOT_NULL(findTopic(payloads, n, "hydra/node2/soil"));
  TEST_ASSERT_NOT_NULL(findTopic(payloads, n, "hydra/node2/status"));
}

// Scenario: The main node publishes retained diagnostic identity and health.
void test_main_diagnostic_snapshot_identifies_the_running_boot() {
  MainDiagnosticSnapshot snapshot{
      "1.4.2",
      "main-node-9f52c1a",
      "aabbccddeeff-0000002a",
      "watchdog",
      70000U,
      false,
      0U,
  };
  MqttPayload payloads[MqttFleetBridge::kMaxDiagnosticPayloads];

  int n = buildMainDiagnosticPayloads(snapshot, payloads);

  TEST_ASSERT_EQUAL_INT(6, n);
  TEST_ASSERT_EQUAL_STRING("1.4.2", findTopic(payloads, n, "hydra/main/diag/firmware")->value);
  TEST_ASSERT_EQUAL_STRING("main-node-9f52c1a",
                           findTopic(payloads, n, "hydra/main/diag/build")->value);
  TEST_ASSERT_EQUAL_STRING("aabbccddeeff-0000002a",
                           findTopic(payloads, n, "hydra/main/diag/boot")->value);
  TEST_ASSERT_EQUAL_STRING("watchdog",
                           findTopic(payloads, n, "hydra/main/diag/reset")->value);
  TEST_ASSERT_EQUAL_STRING("70", findTopic(payloads, n, "hydra/main/diag/uptime_s")->value);
  TEST_ASSERT_EQUAL_STRING("never",
                           findTopic(payloads, n, "hydra/main/diag/last_publish_s")->value);

  for (int i = 0; i < n; i++) {
    TEST_ASSERT_NULL(strstr(payloads[i].topic, "password"));
    TEST_ASSERT_NULL(strstr(payloads[i].topic, "ssid"));
    TEST_ASSERT_NULL(strstr(payloads[i].value, "test-psk-not-real"));
  }
}

// Scenario: Diagnostic health records the previous successful publication.
void test_main_diagnostics_report_the_previous_success_without_mutating_input() {
  MainDiagnosticSnapshot snapshot{
      "1.4.2",
      "main-node-9f52c1a",
      "aabbccddeeff-0000002a",
      "power-on",
      70000U,
      true,
      12000U,
  };
  MqttPayload payloads[MqttFleetBridge::kMaxDiagnosticPayloads];

  int n = buildMainDiagnosticPayloads(snapshot, payloads);

  TEST_ASSERT_EQUAL_STRING("70", findTopic(payloads, n, "hydra/main/diag/uptime_s")->value);
  TEST_ASSERT_EQUAL_STRING("12",
                           findTopic(payloads, n, "hydra/main/diag/last_publish_s")->value);
  TEST_ASSERT_EQUAL_UINT32(12000U, snapshot.lastSuccessfulPublishMs);
}

// Scenario: Incoming MQTT messages are classified before physical execution.
void test_incoming_messages_are_classified() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  const char* ota = "v=7;size=131072;sha=000102030405060708090a0b0c0d0e0f"
                    "101112131415161718191a1b1c1d1e1f;url=http://192.168.1.2/fw.bin";

  MqttFleetBridge::Incoming incoming = b.classifyIncoming("hydra/main/ota/cmd", ota, kNow);
  TEST_ASSERT_EQUAL(MqttFleetBridge::IncomingKind::MainOta, incoming.kind);
  TEST_ASSERT_TRUE(incoming.ota.valid);
  TEST_ASSERT_EQUAL_UINT32(7, incoming.ota.version);

  incoming = b.classifyIncoming("hydra/main/ota/sub/cmd", ota, kNow);
  TEST_ASSERT_EQUAL(MqttFleetBridge::IncomingKind::SubOta, incoming.kind);
  TEST_ASSERT_TRUE(incoming.ota.valid);

  incoming = b.classifyIncoming("hydra/node3/pump/set", "true", kNow);
  TEST_ASSERT_EQUAL(MqttFleetBridge::IncomingKind::Pump, incoming.kind);
  TEST_ASSERT_TRUE(incoming.pump.on);
  TEST_ASSERT_EQUAL_UINT8(3, incoming.pump.nodeId);

  incoming = b.classifyIncoming("hydra/main/ota/cmd", "bad", kNow);
  TEST_ASSERT_EQUAL(MqttFleetBridge::IncomingKind::None, incoming.kind);
  incoming = b.classifyIncoming("hydra/main/temp", "true", kNow);
  TEST_ASSERT_EQUAL(MqttFleetBridge::IncomingKind::None, incoming.kind);
}

// Scenario: Sub-node OTA progress is a bridge payload.
void test_sub_ota_progress_is_a_payload() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  MqttPayload payload{};
  b.buildSubOtaProgressPayload("announced", payload);

  TEST_ASSERT_EQUAL_STRING("hydra/main/ota/sub/progress", payload.topic);
  TEST_ASSERT_EQUAL_STRING("announced", payload.value);
}

// Topic parsing: only hydra/node<N>/plan is a Directive.
void test_parse_timetable_topic() {
  TEST_ASSERT_EQUAL_UINT8(3, parseTimetableTopic("hydra/node3/timetable"));
  TEST_ASSERT_EQUAL_UINT8(12, parseTimetableTopic("hydra/node12/timetable"));
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/node3/timetable/ack"));
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/node3/plan"));
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/node3/pump/set"));
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/main/timetable"));
  // Trailing junk and a signed-overflow id must not parse as a Window topic.
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/node3/timetable anything"));
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/node3/timetablex"));
  TEST_ASSERT_EQUAL_UINT8(0, parseTimetableTopic("hydra/node99999999999/timetable"));
}

// Scenario: The plan intent is named on the wire, and anything else is not a
// Directive -- a stray payload must never turn into pump time.
void test_parse_timetable_payload() {
  Timetable table{};
  uint32_t seq = 0;

  // An empty Window is a real Window: it says "water nothing", not "no Window".
  TEST_ASSERT_TRUE(parseTimetableDirective("SUMMER@29712345", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29712345u, seq);
  TEST_ASSERT_EQUAL_UINT8(0, table.count);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Summer),
                          static_cast<uint8_t>(table.season));

  TEST_ASSERT_TRUE(parseTimetableDirective("AUTUMN;15/top_up;95/standard/night@40", table, seq));
  TEST_ASSERT_EQUAL_UINT32(40u, seq);
  TEST_ASSERT_EQUAL_UINT8(2, table.count);
  TEST_ASSERT_EQUAL_UINT16(15, table.entries[0].offsetMinutes);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::TopUp),
                          static_cast<uint8_t>(table.entries[0].intent));
  TEST_ASSERT_FALSE(table.entries[0].night);
  TEST_ASSERT_EQUAL_UINT16(95, table.entries[1].offsetMinutes);
  TEST_ASSERT_TRUE(table.entries[1].night);

  // The publisher's capitalisation is not part of the contract.
  TEST_ASSERT_TRUE(parseTimetableDirective("summer;0/deep_soak@7", table, seq));

  // A season this firmware cannot name is not a Window it can execute.
  TEST_ASSERT_FALSE(parseTimetableDirective("MONSOON;15/top_up@7", table, seq));
  // Nor is an intent that does not water: holding is an empty Window, not an entry.
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/hold@7", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/autonomous@7", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/nonsense@7", table, seq));
  // Structural faults the device would also refuse, rejected here rather than forwarded.
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;240/top_up@7", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;20/top_up;10/standard@7", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;10/top_up;10/standard@7", table, seq));
  TEST_ASSERT_FALSE(
      parseTimetableDirective("SUMMER;1/top_up;2/top_up;3/top_up;4/top_up;5/top_up@7", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up/late@7", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;/top_up@7", table, seq));
}

// Scenario: The main node acknowledges the Directive it forwarded, naming the plan
// and the local clock time it went out on.
void test_timetable_ack_payload() {
  MqttPayload out{};
  Timetable table{};
  table.season = Season::Summer;
  table.count = 2;
  buildTimetableAckPayload(2, table, EnvTimeSnapshot{13, 34, 9}, out);
  TEST_ASSERT_EQUAL_STRING("hydra/node2/timetable/ack", out.topic);
  TEST_ASSERT_EQUAL_STRING("2@13:34", out.value);

  EnvTimeSnapshot noTime{EnvTimeSnapshot::kInvalid, EnvTimeSnapshot::kInvalid,
                         EnvTimeSnapshot::kInvalid};
  Timetable empty{};
  empty.season = Season::Summer;
  buildTimetableAckPayload(1, empty, noTime, out);
  TEST_ASSERT_EQUAL_STRING("hydra/node1/timetable/ack", out.topic);
  // Zero entries is an authored "water nothing", and it reads as a zero rather than as a
  // Window that never arrived.
  TEST_ASSERT_EQUAL_STRING("0@NC", out.value);
}

// Scenario: A published Directive reaches the fleet as a forwardable command, and
// a malformed one reaches nothing.
void test_incoming_timetable_is_classified() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);

  MqttFleetBridge::Incoming one =
      b.classifyIncoming("hydra/node2/timetable", "SUMMER;15/standard@1000", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::Timetable),
                    static_cast<int>(one.kind));
  TEST_ASSERT_TRUE(one.timetable.valid);
  TEST_ASSERT_EQUAL_UINT8(2, one.timetable.nodeId);
  TEST_ASSERT_EQUAL_UINT32(1000u, one.timetable.seq);
  TEST_ASSERT_EQUAL_UINT8(1, one.timetable.table.count);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Summer),
                          static_cast<uint8_t>(one.timetable.table.season));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::Standard),
                          static_cast<uint8_t>(one.timetable.table.entries[0].intent));

  // A malformed Window stops at ingress rather than being forwarded and refused twice.
  MqttFleetBridge::Incoming malformed =
      b.classifyIncoming("hydra/node2/timetable", "nonsense", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::None),
                    static_cast<int>(malformed.kind));

  MqttFleetBridge::Incoming badSeason =
      b.classifyIncoming("hydra/node2/timetable", "MONSOON@1001", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::None),
                    static_cast<int>(badSeason.kind));
}

// Scenario: A Directive carries the sequence that makes a replay droppable, and a
// payload without one is not a Directive at all.
void test_a_timetable_needs_a_sequence() {
  Timetable table{};
  uint32_t seq = 0;
  // A Window without a sequence is not a Window: accepting one would hand a retained
  // publish a way around the replay drop.
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up@", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up@12x", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up@-1", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up@0", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("@5", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up@42949672960", table, seq));
}

// Scenario: A replayed Directive is dropped, and a newer one is not.
void test_a_replayed_window_is_dropped() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);

  MqttFleetBridge::Incoming first =
      b.classifyIncoming("hydra/node2/timetable", "SUMMER;15/standard@1000", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::Timetable),
                    static_cast<int>(first.kind));
  TEST_ASSERT_EQUAL_UINT32(1000u, first.timetable.seq);

  // The same Window re-delivered -- a retained replay or a QoS-1 copy -- must not read as a
  // fresh Window, or a schedule whose entries already ran would be armed a second time.
  MqttFleetBridge::Incoming replay =
      b.classifyIncoming("hydra/node2/timetable", "SUMMER;15/standard@1000", kNow + 1000);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::TimetableReplay),
                    static_cast<int>(replay.kind));

  // An older Window is a replay too.
  MqttFleetBridge::Incoming older = b.classifyIncoming("hydra/node2/timetable", "SUMMER@999", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::TimetableReplay),
                    static_cast<int>(older.kind));

  // The identity is tracked per zone, so a zone's first Window is not measured against
  // another zone's.
  MqttFleetBridge::Incoming otherZone =
      b.classifyIncoming("hydra/node3/timetable", "SUMMER@999", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::Timetable),
                    static_cast<int>(otherZone.kind));

  // A genuinely newer Window is forwarded normally, including one that waters nothing.
  MqttFleetBridge::Incoming newer =
      b.classifyIncoming("hydra/node2/timetable", "AUTUMN@1001", kNow);
  TEST_ASSERT_EQUAL(static_cast<int>(MqttFleetBridge::IncomingKind::Timetable),
                    static_cast<int>(newer.kind));
  TEST_ASSERT_EQUAL_UINT8(0, newer.timetable.table.count);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Autumn),
                          static_cast<uint8_t>(newer.timetable.table.season));
}

// Scenario: The spec's derivation fixtures parse, and so do its grammar-only fixtures.
// Both ends are tested against these strings -- they are the only cross-language pin -- and
// only the derivation ones may ever be asserted as *output* by the Supervisor's suite, because
// a grammar-only fixture (a `night` marker on a mid-morning entry, say) is not something a
// clock can produce.
void test_the_specs_timetable_payloads_parse() {
  Timetable table{};
  uint32_t seq = 0;

  // Derivation fixture: a held 00:00 Window owns the trigger and waters nothing.
  TEST_ASSERT_TRUE(parseTimetableDirective("SUMMER@29836320", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29836320u, seq);
  TEST_ASSERT_EQUAL_UINT8(0, table.count);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Summer),
                          static_cast<uint8_t>(table.season));

  // Derivation fixture: a 00:00 Window's 00:15 entry is night, and the marker is the only
  // thing on the wire that says so.
  TEST_ASSERT_TRUE(parseTimetableDirective("SUMMER;15/top_up/night@29836320", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29836320u, seq);
  TEST_ASSERT_EQUAL_UINT8(1, table.count);
  TEST_ASSERT_EQUAL_UINT16(15, table.entries[0].offsetMinutes);
  TEST_ASSERT_TRUE(table.entries[0].night);

  // Derivation fixture: an 08:00 Window's four offsets are all daylight.
  TEST_ASSERT_TRUE(parseTimetableDirective(
      "SUMMER;15/top_up;95/standard;165/standard;225/deep_soak@29836800", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29836800u, seq);
  TEST_ASSERT_EQUAL_UINT8(4, table.count);
  TEST_ASSERT_EQUAL_UINT16(15, table.entries[0].offsetMinutes);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::TopUp),
                          static_cast<uint8_t>(table.entries[0].intent));
  TEST_ASSERT_EQUAL_UINT16(95, table.entries[1].offsetMinutes);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::Standard),
                          static_cast<uint8_t>(table.entries[1].intent));
  TEST_ASSERT_EQUAL_UINT16(165, table.entries[2].offsetMinutes);
  TEST_ASSERT_FALSE(table.entries[2].night);
  TEST_ASSERT_EQUAL_UINT16(225, table.entries[3].offsetMinutes);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Plan::DeepSoak),
                          static_cast<uint8_t>(table.entries[3].intent));
  TEST_ASSERT_FALSE(table.entries[3].night);

  // Derivation fixture: 20:00 + 60 min is 21:00, the gate's own edge, so it is night.
  TEST_ASSERT_TRUE(parseTimetableDirective("SUMMER;60/standard/night@29837520", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29837520u, seq);
  TEST_ASSERT_TRUE(table.entries[0].night);

  // Derivation fixture: a November Window declares autumn, and 08:45 is daylight.
  TEST_ASSERT_TRUE(parseTimetableDirective("AUTUMN;45/standard@29911680", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29911680u, seq);
  TEST_ASSERT_EQUAL_UINT8(1, table.count);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Autumn),
                          static_cast<uint8_t>(table.season));
  TEST_ASSERT_EQUAL_UINT16(45, table.entries[0].offsetMinutes);
  TEST_ASSERT_FALSE(table.entries[0].night);

  // Cross-seam pin: the same canonical strings the container's suite names, so the two ends
  // cannot drift on the grammar without one of the suites failing. The container's list is
  // `firmware/docker/tests/test_supervisor.py`,
  // `test_parse_timetable_round_trips_the_command_grammar`.
  TEST_ASSERT_TRUE(parseTimetableDirective("SUMMER@29836800", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29836800u, seq);
  TEST_ASSERT_EQUAL_UINT8(0, table.count);

  TEST_ASSERT_TRUE(parseTimetableDirective(
      "SUMMER;15/top_up;95/standard;165/standard/night;225/deep_soak@29836800", table, seq));
  TEST_ASSERT_EQUAL_UINT32(29836800u, seq);
  TEST_ASSERT_EQUAL_UINT8(4, table.count);
  TEST_ASSERT_FALSE(table.entries[0].night);
  TEST_ASSERT_FALSE(table.entries[1].night);
  TEST_ASSERT_TRUE(table.entries[2].night);
  TEST_ASSERT_FALSE(table.entries[3].night);

  // Grammar-only fixture: the marker mid-table parses wherever the author puts it.
  TEST_ASSERT_TRUE(parseTimetableDirective(
      "SUMMER;15/top_up;95/standard/night;225/deep_soak@29836800", table, seq));
  TEST_ASSERT_EQUAL_UINT8(3, table.count);
  TEST_ASSERT_TRUE(table.entries[1].night);
  TEST_ASSERT_FALSE(table.entries[0].night);
}

// Scenario: The spec's malformed-but-parseable examples are refused whole, an empty field is
// malformed rather than skipped, and WINTER is well formed because dormancy is an actuator
// limit the device applies, not a structural rule the parser may impose.
void test_the_specs_malformed_payloads_are_refused_whole() {
  Timetable table{};
  uint32_t seq = 0;

  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;95/standard;95/top_up@29836640", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;240/standard@29836640", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;95/hold@29836640", table, seq));
  // `SUMMER@0` is refused for the reason the spec gives: zero is not a Window identity.
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER@0", table, seq));

  // An empty field is not a field. `strtok_r` used to collapse runs of ';', which made the
  // device execute what the authoring side calls malformed -- the two ends disagreeing about
  // their own grammar. Each of these is refused, and the Python parser refuses them too.
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;;15/top_up@29836640", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up;@29836640", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective("SUMMER;15/top_up;;95/standard@29836640", table, seq));
  TEST_ASSERT_FALSE(parseTimetableDirective(";SUMMER@29836640", table, seq));

  TEST_ASSERT_TRUE(parseTimetableDirective("WINTER;10/standard@29836640", table, seq));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(Season::Winter),
                          static_cast<uint8_t>(table.season));
  TEST_ASSERT_EQUAL_UINT8(1, table.count);
}

// Scenario: The outcome topic appears when an entry is consumed, carries the refusal code
// the executor decided, and is silent until a Window exists.
void test_the_outcome_topic_is_silent_until_a_window_exists() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  NodeStatus node = nodeStatus(42.0f, true, PumpStatus::Idle, true);  // ttOutcomeWindowSeq 0
  MqttPayload out{};

  // A zero Window means no verdict yet. Publishing `window=0` would invent a Window, and a
  // change there would clear the retained record, so both the builder and the change
  // detector stay silent.
  TEST_ASSERT_FALSE(b.buildTimetableOutcomePayload(node, out));
  TEST_ASSERT_FALSE(b.outcomeChanged(node));
}

void test_the_outcome_topic_names_the_window_counters_and_last_verdict() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  NodeStatus node = nodeStatus(42.0f, true, PumpStatus::Idle, true);
  node.ttOutcomeWindowSeq = 29836800u;
  node.ttOutcomeIndex = 2;
  node.ttOutcomeCode = static_cast<uint8_t>(EntryRefusal::MinGap);
  node.ttRanCount = 3;
  node.ttRefusedCount = 1;

  MqttPayload out{};
  TEST_ASSERT_TRUE(b.buildTimetableOutcomePayload(node, out));
  TEST_ASSERT_EQUAL_STRING("hydra/node2/timetable/outcome", out.topic);
  TEST_ASSERT_EQUAL_STRING("window=29836800;ran=3;refused=1;last=2/MIN_GAP", out.value);
}

void test_the_outcome_topic_publishes_on_change_only() {
  MqttFleetBridge b(kRefreshMs, kMaxForceMs);
  NodeStatus node = nodeStatus(42.0f, true, PumpStatus::Idle, true);
  node.ttOutcomeWindowSeq = 29836800u;
  node.ttOutcomeCode = static_cast<uint8_t>(EntryRefusal::None);
  node.ttRanCount = 1;

  TEST_ASSERT_TRUE(b.outcomeChanged(node));   // first verdict seeds the broker
  TEST_ASSERT_FALSE(b.outcomeChanged(node));  // the ~2 s repeat must not flood

  // A different entry consumed in the same Window is a change.
  node.ttOutcomeIndex = 1;
  node.ttRanCount = 2;
  TEST_ASSERT_TRUE(b.outcomeChanged(node));
  TEST_ASSERT_FALSE(b.outcomeChanged(node));

  // A newer Window is a change even at the same counters.
  node.ttOutcomeWindowSeq = 29836801u;
  node.ttOutcomeIndex = 0;
  node.ttRanCount = 1;
  node.ttRefusedCount = 0;
  TEST_ASSERT_TRUE(b.outcomeChanged(node));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_env_payloads_topics_and_format);
  RUN_TEST(test_env_invalid_publishes_nothing);
  RUN_TEST(test_env_without_lux_skips_lux);
  RUN_TEST(test_env_lux_clamped_to_homekit_minimum);
  RUN_TEST(test_parse_pump_set_topic);
  RUN_TEST(test_parse_on_off_payloads);
  RUN_TEST(test_node_topic_builder);
  RUN_TEST(test_set_on_latches_force_and_emits_command);
  RUN_TEST(test_keep_alive_resends_on_interval);
  RUN_TEST(test_set_off_releases_force);
  RUN_TEST(test_force_auto_releases_after_safety_cap);
  RUN_TEST(test_two_forced_nodes_both_keep_alive);
  RUN_TEST(test_malformed_topic_ignored);
  RUN_TEST(test_invalid_payload_does_not_release_active_force);
  RUN_TEST(test_off_payloads_release_active_force);
  RUN_TEST(test_full_bridge_rejects_untracked_command);
  RUN_TEST(test_online_change_detection);
  RUN_TEST(test_pump_change_detection);
  RUN_TEST(test_status_change_detection);
  RUN_TEST(test_diagnostic_change_detection);
  RUN_TEST(test_environment_snapshot_includes_availability);
  RUN_TEST(test_snapshot_preserves_core_metrics_when_lux_is_invalid);
  RUN_TEST(test_invalid_environment_snapshot_marks_vpd_nc);
  RUN_TEST(test_snapshot_reports_untrustworthy_clock);
  RUN_TEST(test_first_node_snapshot_contains_all_semantic_payloads);
  RUN_TEST(test_node_snapshot_publishes_nc_on_soil_invalid_transition);
  RUN_TEST(test_node_heartbeat_republishes_unchanged_snapshot);
  RUN_TEST(test_main_diagnostic_snapshot_identifies_the_running_boot);
  RUN_TEST(test_main_diagnostics_report_the_previous_success_without_mutating_input);
  RUN_TEST(test_incoming_messages_are_classified);
  RUN_TEST(test_sub_ota_progress_is_a_payload);
  RUN_TEST(test_parse_timetable_topic);
  RUN_TEST(test_parse_timetable_payload);
  RUN_TEST(test_timetable_ack_payload);
  RUN_TEST(test_incoming_timetable_is_classified);
  RUN_TEST(test_a_timetable_needs_a_sequence);
  RUN_TEST(test_a_replayed_window_is_dropped);
  RUN_TEST(test_the_specs_timetable_payloads_parse);
  RUN_TEST(test_the_specs_malformed_payloads_are_refused_whole);
  RUN_TEST(test_the_outcome_topic_is_silent_until_a_window_exists);
  RUN_TEST(test_the_outcome_topic_names_the_window_counters_and_last_verdict);
  RUN_TEST(test_the_outcome_topic_publishes_on_change_only);
  return UNITY_END();
}
