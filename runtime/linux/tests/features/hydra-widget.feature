Feature: Hydra plant and environment widget on the Home grid

  The Home grid carries a Hydra widget fed by the Hydra MQTT bridge
  (Mosquitto on the NAS). It shows the two caladium watering nodes
  (soil moisture, pump state, online state) and the main node's
  environment sensors (temperature, humidity, pressure, lux).

  Scenario: Unconfigured Hydra bridge stays honest
    Given no Hydra MQTT broker URL is configured
    When the Home grid renders
    Then the Hydra widget says the bridge is unconfigured
    And no soil moisture, pump state, or environment reading is fabricated

  Scenario: Hydra widget shows live plant and environment status
    Given the Hydra MQTT bridge is configured and connected
    And node 1 reports soil 62 percent with the pump idle and online
    And node 2 reports soil 48 percent while watering and online
    And the main node reports temperature, humidity, pressure and lux
    When the Hydra widget refreshes
    Then both plant rows show their soil percentage and watering state
    And the environment section renders stacked instrument rows with the label above a large tabular reading
    And the header sits at the top edge of the tile while the readings breathe evenly below it
    And the live badge renders as a quiet outlined live-state pill
    And the widget states a live data status

  Scenario: Invalid or offline readings stay truthful
    Given the Hydra MQTT bridge is configured and connected
    When node 1 publishes an invalid soil reading
    And node 2 publishes offline
    Then node 1 shows the soil reading as unavailable
    And node 2 is marked offline without fabricating moisture

  Scenario: Silent environment data dims instead of vanishing
    Given the Hydra MQTT bridge is configured and connected
    And the main node stopped publishing environment readings
    When the Hydra widget refreshes after the environment staleness window
    Then the widget marks the environment data as stale
    And it keeps showing the last known readings dimmed under the stale badge
    And it never presents the stale readings as live

  Scenario: Plant rows carry a soil moisture meter
    Given the Hydra MQTT bridge is configured and connected
    And node 1 reports soil 62 percent and node 2 reports soil 44 percent
    When the Hydra widget refreshes
    Then each plant row shows a soil meter bar filled to its reported percentage
    And a plant below the dry threshold shows its meter in the dry color

  Scenario: Hydra occupies the right-edge tall slot and replaces the screen-size tile
    Given the Home grid renders with the Hydra widget placed at column 5 spanning rows 2 to 4
    Then the Hydra widget is a one-column by two-row tile
    And the former screen-size desk-status widget is removed from the grid
    And the Home grid still declares ten widgets in total
