Feature: Fleet status dashboard on the main node
  As a home gardener with several watering sub-nodes
  I want the main node to show each sub-node's soil moisture and pump state
  So that I can check the whole fleet from one screen without a serial cable

  # View navigation (BtnA front = page toggle, BtnB side = cycle nodes).

  Scenario: Front button toggles between the environment and fleet pages
    Given the main node is showing the environment page
    When the front button is pressed
    Then the fleet page is shown
    When the front button is pressed again
    Then the environment page is shown

  Scenario: Side button cycles through the known sub-nodes on the fleet page
    Given the fleet page is shown with 3 known sub-nodes
    And the first sub-node is selected
    When the side button is pressed
    Then the second sub-node is selected
    When the side button is pressed two more times
    Then the first sub-node is selected again

  Scenario: Side button does nothing on the environment page
    Given the main node is showing the environment page
    When the side button is pressed
    Then the environment page is still shown

  # Roster: sub-nodes report soil + pump status over ESP-NOW.

  Scenario: A status report registers a sub-node and its readings
    Given the main node has an empty fleet roster
    When a status report arrives from a sub-node with soil 42% and status Pulse
    Then the roster has 1 node showing 42% soil and status Pulse
    And that node is online

  Scenario: A sub-node goes offline after the timeout
    Given a sub-node last reported 9 seconds ago
    And the offline timeout is 8 seconds
    When the roster is ticked
    Then that node is shown offline

  Scenario: The selected node clamps when the fleet shrinks
    Given the fleet page has 3 nodes with the third selected
    When the fleet shrinks to 2 nodes
    Then the selection clamps to a valid node

  # Node operating status: one value derived from a single priority ladder, shared
  # by the sub-node, the wire protocol, and every display.

  Scenario: A manually forced pump reads as watering, not paused
    Given a zone whose pump is forced on while the controller is paused
    When its operating status is derived
    Then the status is Watering

  Scenario: An auto pulse cycle reads as pulsing or soaking
    Given a zone in the pulse-on phase
    When its operating status is derived
    Then the status is Pulse

  Scenario: A dormant (winter) zone reads as dormant
    Given a zone whose seasonal config is disabled
    When its operating status is derived
    Then the status is Dormant

  Scenario: A fault outranks every other state
    Given a zone that is faulted and also paused
    When its operating status is derived
    Then the status is Fault

  # Diagnostic telemetry: the main node forwards the sub-node's operating status
  # label and a few runtime values to MQTT so a misbehaving watering cycle can be
  # explained from the persisted log alone -- no USB serial required.

  Scenario: The operating status label is forwarded to MQTT on every transition
    Given a sub-node reports its status as Soak
    When the main node processes the status report
    Then "hydra/node<N>/status" is published with value "SOAK"
    When the sub-node transitions to Fault
    Then "hydra/node<N>/status" is published with value "FAULT"

  Scenario: A status report carries pulse count, effective dry percent, season, and firmware version
    Given a sub-node that is 2 pulses into a watering cycle in summer with firmware version 3
    When a status report arrives from it
    Then the report carries pulseCount=2 and effDryPercent and season=summer and version=3
    And the main node forwards each to "hydra/node<N>/pulse", "/effdry", "/season", "/ver"

  # Remote force-watering: side-button hold acts like holding the sub-node's own
  # button, with a fail-safe so a lost packet can't leave the pump running.

  Scenario: Holding the side button on a selected node forces its pump
    Given the fleet page shows an online sub-node
    When the side button is held
    Then a pump-on command is sent to that node and re-sent while held
    And the node shows WATER on the main screen
    When the side button is released
    Then a pump-off command is sent to that node

  Scenario: A forced pump stops itself if commands stop arriving
    Given a sub-node was told to force its pump on
    When it hears no further pump command within the timeout
    Then it stops the pump and returns to auto mode
