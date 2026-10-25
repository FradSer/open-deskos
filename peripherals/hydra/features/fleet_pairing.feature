Feature: Pairing sub-nodes to fixed, persistent IDs
  As a home gardener growing the fleet plant by plant
  I want to pair each sub-node to a fixed number from the main node
  So that every plant keeps a stable identity that survives reboots

  # The main node enters Config mode through the settings menu (long-press the
  # front button, select Pairing -- see features/settings_menu.feature); the
  # operator long-presses the sub-node's button to request an ID; the assignment
  # is saved in NVS on both ends. The sub-node's blue LED blinks while requesting
  # and goes solid on success.

  Scenario: Pairing assigns the next fixed ID
    Given the main node is in Config mode with no nodes paired
    When a sub-node requests pairing
    Then it is assigned node 1
    And the assignment is saved on both the main node and the sub-node

  Scenario: Re-pairing the same device keeps its ID
    Given a sub-node is already paired as node 2
    When that same sub-node requests pairing again
    Then it is assigned node 2 again

  Scenario: IDs are never reused as the fleet grows
    Given nodes 1, 2 and 3 are paired
    When a new sub-node requests pairing
    Then it is assigned node 4

  Scenario: The roster survives a reboot
    Given nodes 1 and 2 are paired and saved
    When the main node reboots
    Then both nodes are still in the roster with the same IDs
    And each is shown offline until it reports again

  Scenario: A sub-node remembers its ID across a reboot
    Given a sub-node was paired as node 2
    When the sub-node reboots
    Then it reports status as node 2 without needing to pair again

  Scenario: Persistent storage keeps the fixed schema and defaults
    Given the main node stores roster data at hydra-fleet/roster
    And main OTA data at hydra-ota/ver and hydra-ota/subseq
    And the broker host at hydra-net/mqtt_host
    And sub-node identity data at hydra-node/id and hydra-node/ch
    And sub-node OTA data at hydra-ota-sub/ver and hydra-ota-sub/seq
    When any storage namespace is missing
    Then roster data stays empty
    And main OTA version defaults to 0 and next sub sequence defaults to 1
    And the broker host is absent
    And sub-node ID and OTA values default to 0 while channel uses its caller fallback

  Scenario: Boot-held button enters forced reconfiguration
    Given a sub-node powers on while its button is held
    And the button remains held for the hold threshold
    When the sub-node finishes booting
    Then forced reconfiguration mode starts
    And the blue LED blinks

  Scenario: Runtime hold does not enter reconfiguration
    Given a paired sub-node has completed booting without a held button
    When the user holds its button during normal operation
    Then forced reconfiguration does not start
    And the node force-waters only while the button is held

  Scenario: Boot-time button bounce does not enter reconfiguration
    Given a sub-node powers on while its button is pressed
    And the button is released before the hold threshold
    When the sub-node finishes booting
    Then forced reconfiguration stays disabled
    And the blue LED stays off

  Scenario: An unpressed button is held high during boot
    Given a sub-node powers on without pressing its button
    And the button input uses an internal pull-up
    When the sub-node finishes booting
    Then forced reconfiguration stays disabled
    And the blue LED stays off

  Scenario: Automatic channel recovery stays visually silent
    Given a paired sub-node loses the main node temporarily
    When it recovers the channel and receives a reassignment
    Then it remains paired with the same ID
    And the blue LED stays off

  Scenario: Manual pairing shows confirmation
    Given a sub-node entered forced reconfiguration from a boot-held button
    When the main node assigns its ID
    Then the blue LED shows pairing confirmation

  Scenario: Pairing feedback prioritizes manual pairing, confirmation, and spotlight
    Given a sub-node is being viewed by the main node
    When manual pairing starts
    Then the blue LED blinks instead of showing the spotlight
    When manual pairing succeeds
    Then the blue LED stays solid for the confirmation window
    When the confirmation window expires
    Then the blue LED shows the active spotlight again

  Scenario: A stale spotlight refresh clears the blue LED
    Given a sub-node is being viewed by the main node
    When the spotlight refresh timeout elapses
    Then the blue LED turns off

  Scenario: Pairing only happens in Config mode
    Given the main node is on the environment or fleet page
    When a sub-node requests pairing
    Then the request is ignored and no ID is assigned
