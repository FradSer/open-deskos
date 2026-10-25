#include <unity.h>

#include <domain/fleet_view.h>

using namespace hydra;

// Mirrors the view-navigation scenarios in features/fleet_status.feature and the
// settings-menu scenarios in features/settings_menu.feature. The FSM is pure, so
// these run on the host: pio test -e native.

void setUp() {}
void tearDown() {}

// Scenario: Front button toggles between the environment and fleet pages
void test_front_short_toggles_env_node() {
  FleetViewState s;  // defaults to Env
  s = onFrontShort(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Node);
  s = onFrontShort(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Env);
}

// Short press from the pairing page cancels back to Env.
void test_front_short_leaves_config() {
  FleetViewState s{FleetView::Config, 0, 0};
  s = onFrontShort(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Env);
}

// Scenario: Long-pressing the front button opens the settings menu
void test_front_long_opens_menu_from_env() {
  FleetViewState s;  // Env
  s = onFrontLong(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Menu);
  TEST_ASSERT_TRUE(s.menuItem == MenuItem::Network);
}

// Scenario: The menu also opens from the fleet page (selection reset each time)
void test_front_long_opens_menu_from_node_with_reset_selection() {
  FleetViewState s{FleetView::Node, 0, 2, MenuItem::Pairing};  // stale selection
  s = onFrontLong(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Menu);
  TEST_ASSERT_TRUE(s.menuItem == MenuItem::Network);
}

// Scenario: Long press in the menu cancels back to the environment page
void test_front_long_cancels_menu() {
  FleetViewState s{FleetView::Menu, 0, 0};
  s = onFrontLong(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Env);
}

// Long press from the pairing page also exits to Env (as before the menu).
void test_front_long_leaves_config() {
  FleetViewState s{FleetView::Config, 0, 0};
  s = onFrontLong(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Env);
}

// Scenario: The side button cycles the menu selection
void test_side_cycles_menu_items_with_wrap() {
  FleetViewState s{FleetView::Menu, 0, 0};
  s = onSide(s);
  TEST_ASSERT_TRUE(s.menuItem == MenuItem::Pairing);
  s = onSide(s);
  TEST_ASSERT_TRUE(s.menuItem == MenuItem::Network);
}

// Scenario: Confirming Network reruns the setup portal
void test_front_short_confirms_network_setup() {
  FleetViewState s{FleetView::Menu, 0, 0, MenuItem::Network};
  s = onFrontShort(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Setup);
}

// Scenario: Confirming Pairing opens the pairing page
void test_front_short_confirms_pairing() {
  FleetViewState s{FleetView::Menu, 0, 0, MenuItem::Pairing};
  s = onFrontShort(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Config);
}

// Scenario: Side button cycles through the known sub-nodes on the fleet page
void test_side_cycles_nodes_with_wrap() {
  FleetViewState s{FleetView::Node, 0, 3};
  s = onSide(s);
  TEST_ASSERT_EQUAL_INT(1, s.selectedNode);
  s = onSide(s);
  s = onSide(s);
  TEST_ASSERT_EQUAL_INT(0, s.selectedNode);  // wrapped back to the first
}

// Scenario: Side button does nothing on the environment page
void test_side_noop_on_env_page() {
  FleetViewState s;  // Env
  s.nodeCount = 3;
  s = onSide(s);
  TEST_ASSERT_TRUE(s.view == FleetView::Env);
  TEST_ASSERT_EQUAL_INT(0, s.selectedNode);
}

// Side press with no known nodes is a safe no-op (no divide-by-zero).
void test_side_noop_with_zero_nodes() {
  FleetViewState s{FleetView::Node, 0, 0};
  s = onSide(s);
  TEST_ASSERT_EQUAL_INT(0, s.selectedNode);
}

// Scenario: The selected node clamps when the fleet shrinks
void test_clamp_selection_when_fleet_shrinks() {
  FleetViewState s{FleetView::Node, 2, 3};  // third selected
  s.nodeCount = 2;                           // fleet shrinks
  s = clampSelection(s);
  TEST_ASSERT_EQUAL_INT(1, s.selectedNode);  // clamped to the last valid node
}

void test_clamp_selection_when_fleet_empty() {
  FleetViewState s{FleetView::Node, 2, 0};
  s = clampSelection(s);
  TEST_ASSERT_EQUAL_INT(0, s.selectedNode);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_front_short_toggles_env_node);
  RUN_TEST(test_front_short_leaves_config);
  RUN_TEST(test_front_long_opens_menu_from_env);
  RUN_TEST(test_front_long_opens_menu_from_node_with_reset_selection);
  RUN_TEST(test_front_long_cancels_menu);
  RUN_TEST(test_front_long_leaves_config);
  RUN_TEST(test_side_cycles_menu_items_with_wrap);
  RUN_TEST(test_front_short_confirms_network_setup);
  RUN_TEST(test_front_short_confirms_pairing);
  RUN_TEST(test_side_cycles_nodes_with_wrap);
  RUN_TEST(test_side_noop_on_env_page);
  RUN_TEST(test_side_noop_with_zero_nodes);
  RUN_TEST(test_clamp_selection_when_fleet_shrinks);
  RUN_TEST(test_clamp_selection_when_fleet_empty);
  return UNITY_END();
}
