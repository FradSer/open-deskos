Feature: Structured environment metrics from the main node
  As the owner of a distributed watering fleet
  I want the main node to compute environment metrics once and broadcast them atomically
  So that sub-nodes consume ready-to-use values without duplicating the algorithms

  # The main node is the single source of derived metrics (VPD today, dew point /
  # PPFD / DLI later). Sub-nodes never recompute them: they read the atomic fields
  # off the wire. This keeps the watering algorithm on the sub-node decoupled from
  # the environment math, which lives only on the sensor hub.

  Scenario: The main node derives VPD from a valid reading
    Given a valid reading of 25 C and 60% RH
    When the main node computes its environment metrics
    Then the VPD metric is about 1.26 kPa
    And the raw temperature, humidity, pressure and lux pass through unchanged

  Scenario: An invalid reading produces no derived metrics
    Given a reading whose sensor read failed
    When the main node computes its environment metrics
    Then the metrics are marked invalid
    And the VPD metric is zero

  Scenario: Humidity above 100% RH yields zero VPD, never negative
    Given a valid reading whose humidity reads just above 100% RH (condensing)
    When the main node computes its environment metrics
    Then the VPD metric is zero

  Scenario: Lux validity is tracked independently of the core reading
    Given a valid temp/humidity/pressure reading with a failed lux read
    When the main node computes its environment metrics
    Then the metrics are valid
    But the lux metric is marked invalid

  # Wire contract: the broadcast carries the derived VPD alongside the raw fields.

  Scenario: A sub-node consumes the broadcast VPD without recomputing it
    Given an env broadcast carrying VPD 1.80 kPa and lux 5000
    When a sub-node receives the broadcast
    Then its env context VPD is 1.80 kPa taken directly from the wire
    And the sub-node does not depend on the VPD formula

  # MQTT path is unchanged: HomeKit only consumes native characteristics
  # (temperature, humidity, ambient light), so derived metrics are not published.

  Scenario: Derived metrics are not pushed to HomeKit
    Given a valid reading with a computed VPD
    When the env payloads are built for MQTT
    Then only the HomeKit-native sensor topics are published
    And no VPD topic is published
