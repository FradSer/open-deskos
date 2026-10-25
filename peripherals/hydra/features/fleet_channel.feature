Feature: Sub-nodes follow the main node's radio channel
  As a home gardener whose router I cannot pin to a fixed channel
  I want the sub-nodes to discover and follow whatever channel the main node ends up on
  So that the fleet link works without touching the router's 2.4 GHz settings

  # The main node, once it joins Wi-Fi, is locked to the router's channel
  # (esp_wifi_set_channel is blocked while associated). It cannot choose the
  # channel, so it reports it: every pairing reply carries the main node's current
  # channel. Sub-nodes have no AP, so their radio is free to set -- they sweep the
  # 2.4 GHz channels until they hear the main node, then lock on and persist it.
  # The same sweep serves first-time pairing and automatic recovery after the
  # router moves the channel. See docs/homekit-mqtt.md.

  Scenario: A sub-node learns the channel when it pairs
    Given the main node is on Wi-Fi channel 6 and in Config mode
    When an unpaired sub-node sweeps the channels requesting an ID
    Then it pairs once it dwells on channel 6
    And it saves both its ID and channel 6 in NVS

  Scenario: A sub-node boots straight onto its remembered channel
    Given a sub-node paired on channel 6
    When the sub-node reboots
    Then it starts on channel 6 without sweeping

  Scenario: A paired sub-node re-discovers the main node after the router moves
    Given a sub-node is paired and locked on channel 6
    And it stops hearing the main node for longer than the silence timeout
    When the router has moved the main node to channel 11
    Then the sub-node sweeps the channels re-broadcasting its pairing request
    And the main node answers because the MAC is already known, keeping its ID
    And the sub-node locks onto channel 11 and saves it

  Scenario: Hearing the main node keeps a locked node from sweeping
    Given a sub-node is locked on a channel
    When it keeps hearing the main node within the silence timeout
    Then it never starts a sweep

  Scenario: An unpaired idle node does not sweep on its own
    Given a sub-node has never been paired
    When no one is holding its button to pair
    Then it stays on the default channel and does not sweep
