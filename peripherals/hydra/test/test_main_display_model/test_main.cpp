#include <unity.h>

#include <main_node/app/main_display_model.h>

using namespace hydra;

namespace {

EnvMetrics environment(float tempC, float humidity, float pressurePa, float lux,
                       float vpdKpa, bool valid, bool luxValid) {
  return EnvMetrics{tempC, humidity, pressurePa, lux, vpdKpa, valid, luxValid};
}

NodeStatus node(float soilPercent, bool soilValid, PumpStatus status, bool online) {
  NodeStatus n{};
  n.nodeId = 2;
  n.mac[4] = 0xAB;
  n.mac[5] = 0xCD;
  n.soil = SoilReading{0, soilPercent, soilValid};
  n.status = status;
  n.online = online;
  return n;
}

}  // namespace

void setUp() {}
void tearDown() {}

// Scenario: Semantic environment values preserve valid and invalid readings.
void test_valid_environment_formats_primary_values() {
  EnvDisplayModel model = makeEnvDisplayModel(environment(25.4f, 61.0f, 101325.0f,
                                                           5000.0f, 1.0f, true, true));

  TEST_ASSERT_TRUE(model.valid);
  TEST_ASSERT_EQUAL_STRING("25.4", model.temperatureText);
  TEST_ASSERT_EQUAL_STRING("61", model.humidityText);
  TEST_ASSERT_EQUAL_STRING("1013", model.pressureText);
  TEST_ASSERT_EQUAL_STRING("1.00", model.vpdText);
  TEST_ASSERT_EQUAL_STRING("OK", vpdDisplayStatusLabel(model.vpdStatus));
}

void test_invalid_environment_uses_placeholders_and_hides_vpd() {
  EnvDisplayModel model = makeEnvDisplayModel(environment(0.0f, 0.0f, 0.0f,
                                                           5000.0f, 0.0f, false, true));

  TEST_ASSERT_FALSE(model.valid);
  TEST_ASSERT_EQUAL_STRING("--", model.temperatureText);
  TEST_ASSERT_EQUAL_STRING("--", model.humidityText);
  TEST_ASSERT_EQUAL_STRING("--", model.pressureText);
  TEST_ASSERT_EQUAL(VpdDisplayStatus::Unavailable, model.vpdStatus);
}

// Scenario Outline: Light status is classified from a valid lux reading.
void test_light_statuses_and_text() {
  EnvDisplayModel low = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                         499.0f, 1.0f, true, true));
  EnvDisplayModel ok = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                        5000.0f, 1.0f, true, true));
  EnvDisplayModel bright = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                            30001.0f, 1.0f, true, true));

  TEST_ASSERT_EQUAL_STRING("499", low.lightText);
  TEST_ASSERT_EQUAL_STRING("LOW", lightDisplayStatusLabel(low.lightStatus));
  TEST_ASSERT_EQUAL_STRING("5000", ok.lightText);
  TEST_ASSERT_EQUAL_STRING("OK", lightDisplayStatusLabel(ok.lightStatus));
  TEST_ASSERT_EQUAL_STRING("30001", bright.lightText);
  TEST_ASSERT_EQUAL_STRING("BRIGHT", lightDisplayStatusLabel(bright.lightStatus));
}

void test_invalid_light_has_no_status() {
  EnvDisplayModel model = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                           0.0f, 1.0f, true, false));

  TEST_ASSERT_EQUAL_STRING("-- lx", model.lightText);
  TEST_ASSERT_EQUAL(LightDisplayStatus::Unavailable, model.lightStatus);
}

// Scenario Outline: VPD status is classified from valid environment metrics.
void test_vpd_statuses_and_text() {
  EnvDisplayModel dry = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                         5000.0f, 1.8f, true, true));
  EnvDisplayModel humid = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                           5000.0f, 0.3f, true, true));
  EnvDisplayModel ok = makeEnvDisplayModel(environment(25.0f, 60.0f, 101325.0f,
                                                        5000.0f, 1.0f, true, true));

  TEST_ASSERT_EQUAL_STRING("1.80", dry.vpdText);
  TEST_ASSERT_EQUAL_STRING("DRY", vpdDisplayStatusLabel(dry.vpdStatus));
  TEST_ASSERT_EQUAL_STRING("0.30", humid.vpdText);
  TEST_ASSERT_EQUAL_STRING("HUMID", vpdDisplayStatusLabel(humid.vpdStatus));
  TEST_ASSERT_EQUAL_STRING("1.00", ok.vpdText);
  TEST_ASSERT_EQUAL_STRING("OK", vpdDisplayStatusLabel(ok.vpdStatus));
}

// Scenario: Soil semantics distinguish valid readings from a disconnected probe.
void test_valid_soil_is_ok_and_invalid_soil_is_nc() {
  NodeDisplayModel valid = makeNodeDisplayModel(node(42.0f, true, PumpStatus::Idle, true),
                                                 0, 2, false);
  NodeDisplayModel invalid = makeNodeDisplayModel(node(0.0f, false, PumpStatus::Idle, true),
                                                   0, 2, false);

  TEST_ASSERT_TRUE(valid.online);
  TEST_ASSERT_EQUAL_STRING("42", valid.soilText);
  TEST_ASSERT_EQUAL_STRING("OK", soilDisplayStatusLabel(valid.soilStatus));
  TEST_ASSERT_EQUAL_STRING("N2", valid.nodeText);
  TEST_ASSERT_EQUAL_STRING("1/2", valid.positionText);
  TEST_ASSERT_EQUAL_STRING("AB:CD", valid.macText);
  TEST_ASSERT_EQUAL_STRING("--", invalid.soilText);
  TEST_ASSERT_EQUAL_STRING("NC", soilDisplayStatusLabel(invalid.soilStatus));
}

// Scenario: Node connectivity is semantic state.
void test_offline_node_has_offline_state() {
  NodeDisplayModel model = makeNodeDisplayModel(node(42.0f, true, PumpStatus::Idle, false),
                                                 0, 1, false);

  TEST_ASSERT_FALSE(model.online);
  TEST_ASSERT_EQUAL(NodeDisplayState::Offline, model.state);
  TEST_ASSERT_EQUAL_STRING("OFFLINE", nodeDisplayStateLabel(model.state));
}

// Scenario: Force watering overrides the last reported pump state.
void test_force_watering_overrides_reported_status() {
  NodeDisplayModel model = makeNodeDisplayModel(node(42.0f, true, PumpStatus::Idle, true),
                                                 0, 1, true);

  TEST_ASSERT_EQUAL(PumpStatus::Watering, model.pumpStatus);
  TEST_ASSERT_EQUAL_STRING("WATER", model.pumpText);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_valid_environment_formats_primary_values);
  RUN_TEST(test_invalid_environment_uses_placeholders_and_hides_vpd);
  RUN_TEST(test_light_statuses_and_text);
  RUN_TEST(test_invalid_light_has_no_status);
  RUN_TEST(test_vpd_statuses_and_text);
  RUN_TEST(test_valid_soil_is_ok_and_invalid_soil_is_nc);
  RUN_TEST(test_offline_node_has_offline_state);
  RUN_TEST(test_force_watering_overrides_reported_status);
  return UNITY_END();
}
