Feature: HomeKit integration over MQTT
  As a home gardener with the Hydra fleet and an Apple Home setup
  I want the main node to publish env readings and per-node pump switches over MQTT
  So that Homebridge (homebridge-mqttthing) exposes them as native HomeKit accessories

  # The main node runs no HAP stack. It joins Wi-Fi on whatever channel the router
  # picked (the fleet follows it -- see features/fleet_channel.feature) and talks to
  # the NAS Mosquitto broker; Homebridge does the bridging. Automatic watering stays
  # entirely in firmware -- HomeKit can never disable it.

  # Environment sensors: hydra/main/{temp,humidity,pressure,lux}

  Scenario: A valid environment reading publishes the sensor topics
    Given a valid env reading of 24.5 C, 61.2 %RH, 1002.6 hPa and 1234 lux
    When the MQTT payloads are built
    Then hydra/main/temp is "24.5"
    And hydra/main/humidity is "61.2"
    And hydra/main/pressure is "1002.6"
    And hydra/main/lux is "1234.0"

  Scenario: An invalid environment reading publishes nothing
    Given an env reading marked invalid
    When the MQTT payloads are built
    Then no topics are published

  Scenario: A reading without lux skips only the lux topic
    Given a valid env reading whose lux is not valid
    When the MQTT payloads are built
    Then temp, humidity and pressure are published but lux is not

  Scenario: Zero lux is clamped to the HomeKit minimum
    Given a valid env reading of 0 lux in a dark room
    When the MQTT payloads are built
    Then hydra/main/lux is "0.0001"

  # Per-node watering switches: hydra/node<N>/pump/set (in), hydra/node<N>/pump
  # and hydra/node<N>/online (out). Switch semantics = force-water, mirroring the
  # main node's side-button remote force; OFF releases and auto decidePump resumes.

  Scenario: A HomeKit switch turning on forces watering on that node
    Given the bridge is idle
    When "true" arrives on hydra/node3/pump/set
    Then a pump-on command for node 3 is emitted
    And node 3 is marked MQTT-forced

  Scenario: The forced node is re-commanded while the switch stays on
    Given node 3 is MQTT-forced
    When the keep-alive interval elapses
    Then another pump-on command for node 3 is emitted

  Scenario: A HomeKit switch turning off releases the force
    Given node 3 is MQTT-forced
    When "false" arrives on hydra/node3/pump/set
    Then a pump-off command for node 3 is emitted
    And node 3 is no longer MQTT-forced

  Scenario: A switch left on auto-releases after the safety limit
    Given node 3 is MQTT-forced
    When the maximum force duration elapses without an off command
    Then a pump-off command for node 3 is emitted
    And node 3 is no longer MQTT-forced

  Scenario: MQTT and physical main-node force owners overlap safely
    Given node 3 is MQTT-forced
    And the main-node side button starts physical force for node 3
    When MQTT force ends while the side button remains held
    Then no remote pump-off command is emitted
    And remote pump-on remains asserted for node 3
    When the side button releases
    Then one remote pump-off command is emitted

  Scenario: Physical force release does not cancel MQTT force
    Given the main-node side button starts physical force for node 3
    And node 3 becomes MQTT-forced
    When the side button releases while MQTT force remains active
    Then no remote pump-off command is emitted
    And MQTT keep-alives retain remote pump-on for node 3

  Scenario: Malformed set topics and payloads are ignored
    Given the bridge is idle
    When a message arrives on a topic that is not hydra/node<N>/pump/set
    Then no command is emitted

  Scenario: An invalid pump payload does not release an active force
    Given node 3 is MQTT-forced
    When an unrecognized payload arrives on hydra/node3/pump/set
    Then no command is emitted
    And node 3 remains MQTT-forced

  Scenario: Explicit off payloads release an active force
    Given node 3 is MQTT-forced
    When "off" or "0" arrives on hydra/node3/pump/set
    Then a pump-off command for node 3 is emitted
    And node 3 is no longer MQTT-forced

  Scenario: A full bridge does not emit an untracked force command
    Given force state is tracked for the maximum number of nodes
    When a pump-on message arrives for another node
    Then no command is emitted

  Scenario: An environment snapshot includes sensor values and main availability
    Given a valid environment reading
    When the MQTT bridge builds its environment snapshot
    Then it includes the environment sensor payloads
    And hydra/main/online is "true"

  Scenario: A valid environment snapshot publishes coherent app-facing data
    Given valid metrics of 24.5 C, 61.2 %RH, 1002.6 hPa, 1234.0 lux, and 1.26 kPa VPD
    And the main clock holds a trusted time of 13:45
    When the MQTT bridge builds its environment snapshot
    Then hydra/main/vpd is "1.26"
    And hydra/main/env is "v=1;l=1;t=24.5;h=61.2;p=1002.6;x=1234.0;d=1.26;hh=13;mm=45"

  Scenario: An untrustworthy main clock is visible on the snapshot
    Given valid metrics of 24.5 C, 61.2 %RH, 1002.6 hPa, 1234.0 lux, and 1.26 kPa VPD
    And the main clock holds no trusted time
    When the MQTT bridge builds its environment snapshot
    Then hydra/main/env carries hh=NC and mm=NC

  Scenario: An invalid-light snapshot remains complete
    Given valid core metrics with an invalid light sensor
    When the MQTT bridge builds its environment snapshot
    Then hydra/main/env carries l=0 and x=0.0 with the core values and VPD

  Scenario: An invalid environment snapshot clears retained authority
    Given an invalid environment reading
    When the MQTT bridge builds its environment snapshot
    Then hydra/main/vpd is "NC"
    And hydra/main/env is "v=0"
    And hydra/main/online is "true"

  Scenario: An unavailable environment sensor still refreshes MQTT liveness
    Given MQTT is enabled but the environment bus or sensor initialization failed
    When the normal environment publication cadence elapses
    Then hydra/main/vpd is published as "NC"
    And hydra/main/env is published as "v=0"
    And hydra/main/online is published as "true"
    But no invalid ESP-NOW environment frame is broadcast

  Scenario: A node snapshot publishes its initial state and diagnostics
    Given an online node with valid soil, status, pulse count, effective dry threshold, season, and version
    When the MQTT bridge builds the node snapshot for the first time
    Then it includes pump, online, soil, status, pulse, effective-dry, season, and version payloads
    And the status payload uses the pump status label
    When the unchanged node snapshot is built again
    Then it has no payloads

  Scenario: A node snapshot reports a disconnected soil probe as NC
    Given a node snapshot was published with valid soil
    When the node reports an invalid soil reading
    Then the next node snapshot includes hydra/node<N>/soil as "NC"

  Scenario: The periodic node heartbeat refreshes the complete retained snapshot
    Given an unchanged online node snapshot was already published
    When the node heartbeat cadence elapses
    Then pump, online, soil, status, pulse, effective-dry, season, and version republish
    And existing MQTT topic names and payload formats remain unchanged

  Scenario: The main node publishes retained diagnostic identity and health
    Given the main node has a firmware version, build identity, boot identity, reset reason, and uptime
    And no MQTT publication has succeeded during this boot
    When it builds the diagnostic snapshot
    Then firmware version, build identity, boot identity, reset reason, uptime, and last successful MQTT publication are present
    And last successful MQTT publication is reported as never
    And the snapshot contains no Wi-Fi or MQTT credentials

  Scenario: Diagnostic health records the previous successful publication
    Given a retained MQTT publication last succeeded at 12 seconds of uptime
    When diagnostics are built at 70 seconds of uptime
    Then uptime is 70 seconds
    And last successful MQTT publication is 12 seconds
    And publishing the diagnostic snapshot does not rewrite the reported last-success value mid-snapshot

  Scenario: Main-node diagnostics use additive MQTT topics only
    Given the existing environment, node, command, and OTA topic contracts
    When diagnostic topics are added below hydra/main/diag
    Then every existing MQTT topic name and payload format remains unchanged

  Scenario: Incoming MQTT messages are classified before physical execution
    Given a valid main-node OTA command
    When the MQTT bridge classifies it
    Then it is a main OTA command
    Given a valid sub-node OTA command
    When the MQTT bridge classifies it
    Then it is a sub-node OTA announcement command
    When a pump set message is classified
    Then it is a pump command
    When a Timetable published on a zone's command topic is classified
    Then it is a Timetable command for that zone
    And a message on that zone's acknowledgement topic is classified as no command
    And a message on that zone's outcome topic is classified as no command
    And an unrelated or malformed command is classified as no command

  # F3: every publish through the bridge is retained and the main node re-subscribes
  # on every reconnect, so a Timetable needs an identity that makes a re-delivery
  # droppable. The publisher stamps one; the main node enforces it.

  Scenario: A Timetable carries the identity that makes a replay droppable
    Given a Timetable payload naming a season and the Window it was authored for
    When the MQTT bridge classifies it
    Then it is a Timetable command carrying that Window
    When the same Timetable arrives again
    Then it is classified as a replayed Window
    And no command is forwarded for it
    When a Timetable arrives carrying an older Window
    Then it is classified as a replayed Window
    When a Timetable arrives carrying a newer Window
    Then it is a Timetable command
    And the Window is tracked per zone, so another zone's Timetable still applies

  Scenario: A Timetable without an identity is not a Timetable
    Given a Timetable payload that names a season but carries no Window identity
    When the MQTT bridge classifies it
    Then it is classified as no command

  Scenario: Sub-node OTA progress is a bridge payload
    When sub-node OTA progress is "announced"
    Then the bridge emits hydra/main/ota/sub/progress as "announced"

  # Outgoing switch/online state follows the centralized PumpStatus model (not the
  # raw pulsing GPIO) so the Home app switch does not flicker during pulse cycles,
  # and publishes only on change so status reports do not flood the broker.

  Scenario: The pump topic publishes only when the watering state changes
    Given node 2 last published pump state off
    When two consecutive status reports both derive pump state off
    Then only the first comparison reports no change and nothing republishes
    When a status report derives state Watering
    Then the pump topic republishes as on

  Scenario: The online topic publishes only on transitions
    Given node 2 last published online true
    When the node stays online
    Then nothing republishes
    When the node times out offline
    Then the online topic republishes as false
