#include <unity.h>

#include <main_node/app/main_runtime.h>

using namespace hydra;

void setUp() {}
void tearDown() {}

// Scenario: The root marks a healthy OTA image only once after the health window.
void test_health_marker_waits_for_window_and_runs_once() {
  TEST_ASSERT_FALSE(shouldMarkOtaValid(false, 14999U, 15000U));
  TEST_ASSERT_TRUE(shouldMarkOtaValid(false, 15000U, 15000U));
  TEST_ASSERT_FALSE(shouldMarkOtaValid(true, 999999U, 15000U));
}

// Scenario: MainRuntime consumes a pre-sampled front button event.
void test_front_click_event_transitions_to_fleet_view() {
  MainButtonEvents events{};
  events.frontClicked = true;

  FleetViewState view = applyMainButtonEvents(FleetViewState{}, events);
  TEST_ASSERT_EQUAL(FleetView::Node, view.view);
}

void test_mqtt_release_does_not_cancel_physical_force() {
  RemoteForceRegistry forces;
  RemoteForceCommand command = forces.setMqtt(3, true);
  TEST_ASSERT_TRUE(command.valid);
  TEST_ASSERT_TRUE(command.on);
  TEST_ASSERT_FALSE(forces.setPhysical(3, true).valid);
  TEST_ASSERT_FALSE(forces.setMqtt(3, false).valid);
  TEST_ASSERT_TRUE(forces.isForced(3));
  command = forces.setPhysical(3, false);
  TEST_ASSERT_TRUE(command.valid);
  TEST_ASSERT_FALSE(command.on);
}

void test_physical_release_does_not_cancel_mqtt_force() {
  RemoteForceRegistry forces;
  RemoteForceCommand command = forces.setPhysical(3, true);
  TEST_ASSERT_TRUE(command.valid);
  TEST_ASSERT_TRUE(command.on);
  TEST_ASSERT_FALSE(forces.setMqtt(3, true).valid);
  TEST_ASSERT_FALSE(forces.setPhysical(3, false).valid);
  TEST_ASSERT_TRUE(forces.isForced(3));
  command = forces.setMqtt(3, false);
  TEST_ASSERT_TRUE(command.valid);
  TEST_ASSERT_FALSE(command.on);
}

void test_force_owners_merge_per_target() {
  RemoteForceRegistry forces;
  TEST_ASSERT_TRUE(forces.setPhysical(1, true).valid);
  TEST_ASSERT_TRUE(forces.setMqtt(2, true).valid);
  TEST_ASSERT_TRUE(forces.isForced(1));
  TEST_ASSERT_TRUE(forces.isForced(2));
  RemoteForceCommand release = forces.setPhysical(1, false);
  TEST_ASSERT_TRUE(release.valid);
  TEST_ASSERT_FALSE(release.on);
  TEST_ASSERT_TRUE(forces.isForced(2));
}

void test_unavailable_environment_remains_due_on_normal_publication_cadence() {
  constexpr uint32_t cadence = 60000U;
  TEST_ASSERT_FALSE(isEnvironmentPublicationDue(59999U, 0U, cadence));
  TEST_ASSERT_TRUE(isEnvironmentPublicationDue(60000U, 0U, cadence));
  TEST_ASSERT_FALSE(isEnvironmentPublicationDue(60001U, 60000U, cadence));
  TEST_ASSERT_TRUE(isEnvironmentPublicationDue(120000U, 60000U, cadence));
}

void test_desktop_release_does_not_cancel_physical_or_mqtt_owner() {
  RemoteForceRegistry registry;
  TEST_ASSERT_TRUE(registry.setDesktop(1, true).on);
  TEST_ASSERT_FALSE(registry.setPhysical(1, true).valid);
  TEST_ASSERT_FALSE(registry.setDesktop(1, false).valid);
  TEST_ASSERT_TRUE(registry.isPhysical(1));
  TEST_ASSERT_TRUE(registry.isForced(1));
  TEST_ASSERT_FALSE(registry.setMqtt(1, true).valid);
  TEST_ASSERT_FALSE(registry.setPhysical(1, false).valid);
  TEST_ASSERT_FALSE(registry.isPhysical(1));
  TEST_ASSERT_TRUE(registry.isForced(1));
  auto release = registry.setMqtt(1, false);
  TEST_ASSERT_TRUE(release.valid); TEST_ASSERT_FALSE(release.on);
  TEST_ASSERT_FALSE(registry.isForced(2));
}
int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_desktop_release_does_not_cancel_physical_or_mqtt_owner);
  RUN_TEST(test_health_marker_waits_for_window_and_runs_once);
  RUN_TEST(test_front_click_event_transitions_to_fleet_view);
  RUN_TEST(test_mqtt_release_does_not_cancel_physical_force);
  RUN_TEST(test_physical_release_does_not_cancel_mqtt_force);
  RUN_TEST(test_force_owners_merge_per_target);
  RUN_TEST(test_unavailable_environment_remains_due_on_normal_publication_cadence);
  return UNITY_END();
}
