Feature: Hydra plant and environment widget on the Home grid

  The Home grid carries a Hydra widget fed by the Hydra MQTT bridge
  (Mosquitto on the NAS). It shows the two caladium watering nodes
  (soil moisture, pump state, online state) and the main node's
  environment sensors (temperature, humidity, pressure, lux).

  Scenario: Packaged Hydra bridge loads its MQTT dependency graph
    Given the CM5 release uses pnpm isolated node modules
    When the Hydra source loads MQTT after a previous connection attempt
    Then it does not delete transitive MQTT modules from Node's module cache
    And the source can reconnect without reporting a missing mqtt-packet module

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

  Scenario: Live MQTT state changes refresh the widget
    Given the Hydra MQTT bridge is configured and connected
    And retained node readings populated the Hydra widget
    When node 1 enters the automatic pulse watering state
    And node 2 enters the idle state after a retained legacy pump flag said watering
    And the main node heartbeat expires
    Then node 1 is shown as watering without waiting for the legacy pump flag
    And node 2 is shown as idle because the current status is authoritative
    And the widget no longer presents the retained readings as live

  Scenario: Invalid or offline readings stay truthful
    Given the Hydra MQTT bridge is configured and connected
    When node 1 publishes an invalid soil reading
    And node 2 publishes offline
    Then node 1 shows the soil reading as unavailable
    And node 2 is marked offline without fabricating moisture

  Scenario: Retained plant readings cannot look live after telemetry stops
    Given retained soil and status readings populated both plant rows
    When the main node is offline or a plant has not refreshed within the freshness window
    Then the affected plant is marked stale
    And its last known soil value remains visible only as historical data
    And the snapshot exposes message timestamps for monitoring

  Scenario: A new dashboard connection does not refresh retained data age
    Given the broker holds an old online heartbeat, environment snapshot, and plant readings
    When Open DeskOS reconnects and receives those retained MQTT messages
    Then the retained values remain available as historical data
    But the main node, environment, and plant rows stay stale until a live publication arrives

  Scenario: Main-node diagnostics identify the running device image
    Given the Hydra main node publishes its retained diagnostic topics
    When Open DeskOS reads the Hydra snapshot
    Then the snapshot includes firmware, build, boot, reset reason, uptime, and last successful publication
    And a new boot identity replaces the prior boot diagnostics
    And diagnostic values never override plant or environment readings

  Scenario: Invalid environment summary clears the old retained readings
    Given the Hydra MQTT bridge is configured and connected
    And a retained environment summary populated the Hydra widget
    When the main node publishes an invalid environment summary
    And retained legacy environment topics arrive afterward
    Then the old environment readings are cleared
    And the legacy topics cannot repopulate the invalid atomic snapshot
    And the widget never keeps presenting them as live

  Scenario: Silent environment data dims instead of vanishing
    Given the Hydra MQTT bridge is configured and connected
    And the main node stopped publishing environment readings
    When the Hydra widget refreshes after the environment staleness window
    Then the widget marks the environment data as stale
    And it keeps showing the last known readings dimmed under the stale badge
    And it never presents the stale readings as live

  Scenario: Environment summary topic hydrates the widget
    Given the Hydra MQTT bridge is configured and connected
    And the main node publishes the retained environment summary
    When the Hydra widget refreshes
    Then the environment section shows the summary temperature, humidity, pressure and lux
    And the widget states a live data status

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
