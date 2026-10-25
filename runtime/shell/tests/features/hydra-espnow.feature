Feature: Hydra telemetry through the shared Bridge

  Scenario: Default Hydra does not use the old network configuration
    Given a host still has its old MQTT endpoint configuration
    When the default Hydra source starts
    Then it uses the same Bridge device facade as Devices
    And it does not construct MQTT or another serial connection

  Scenario: Actual Main preserves the existing Hydra consumers
    Given an isolated Bridge fixture supplies a paired Hydra telemetry stream
    And the host retains an old MQTT URL
    When actual Main starts with its default source and real preload
    Then the existing Hydra Widget and App show the same sensor values
    And Devices and Hydra share one Bridge connection
    And no MQTT source is constructed
    And this fixture does not establish physical device acceptance

  Scenario: Bind only a configured general peer
    Given Bridge supplies its configured peer identities
    When a trusted Shell frame binds Hydra to a general peer
    Then the host stores that exact peer in a private atomic profile
    And an arbitrary peer or the reserved Remote peer is refused
    And an unrelated frame cannot change the selection

  Scenario: Only the selected current Hydra session publishes readings
    Given a selected paired Hydra peer
    When its versioned hello starts a session
    Then its ordered environment and node messages update the existing Hydra snapshot
    And duplicate sequences, retired boots, foreign peers, and malformed messages are ignored
    And environment and node measurement ages retain their existing stale limits

  Scenario: Radio availability and Hydra liveness are separate
    Given ordinary peer freshness expires after three and a half seconds
    And valid Hydra hello messages arrive within ten seconds
    Then Hydra remains available through the shared gateway
    When the gateway disconnects or the application heartbeat expires
    Then Hydra is unavailable and cannot present its previous data as live

  Scenario: Changing selection releases the previous identity
    Given a pending old-peer callback
    When the operator changes or removes the selected peer
    Then previous readings and session state are cleared
    And an old callback cannot label telemetry with the new selection
    And shutdown releases subscriptions without stopping Bridge

  Scenario: Generic Apps cannot bypass control confirmation
    Given an App has a generic send grant for the Hydra peer
    When it sends an unsigned or altered control packet
    Then the controller does not change watering or its plan
    And the packet cannot bypass Devices confirmation

  Scenario: Desktop control has an authenticated bounded wire format
    Given a separately configured private control key and selected MAC pair
    When the host encodes a watering action or a four-hour plan
    Then the complete packet is exactly 128 bytes
    And its signature covers both MAC addresses, boot, challenge, command, deadline, and body
    And malformed fields, padding, signatures, or foreign MAC pairs are refused

  Scenario: Trusted actions use one-time device challenges
    Given Devices has a current authenticated controller session
    When the user confirms a watering action or plan
    Then the broker signs that exact action with a fresh device challenge
    And lost acknowledgements do not cause automatic actuator retries
    And changing peer, boot, connection, or closing Devices cancels pending confirmation

  Scenario: Desktop watering remains bounded on the device
    Given the device accepted a desktop watering lease
    When contact stops or the fixed lease expires
    Then only the desktop watering owner is released
    And duplicate actions or heartbeats cannot extend the fixed lease
    And an independent physical owner is reported separately

  Scenario: Host control needs a separate safe private key
    Given no safe private 32-byte control key exists
    When Devices prepares an action
    Then control stays disabled without writing or provisioning a key
    And Windows fails closed without reliable ACL validation

  Scenario: Preparation and confirmation remain separate
    Given a trusted visible Devices session and signed controller status
    When the user prepares a bounded action
    Then the broker returns a short-lived single-use token and safe summary
    And it sends no actuator command before confirmation
    When the user confirms that token
    Then a fresh challenge signs exactly that payload
    And every asynchronous boundary rechecks authority and scope

  Scenario: Devices closure cancels desktop control
    Given a pending confirmation or accepted desktop lease
    When Devices closes or presence expires after one second
    Then the broker clears confirmation and stops heartbeats
    And late replies cannot actuate the controller

  Scenario: A delivery receipt cannot prove controller acceptance
    Given a confirmed command has a MAC receipt
    Then it still waits for an authenticated main acknowledgement
    When that acknowledgement is lost
    Then its result is unknown without action replay or heartbeats

  Scenario: A plan sequence is reserved by the host before transmission
    Given a private host sequence store for the selected peer and node
    When Devices prepares a plan without an internal sequence field
    Then the broker fixes a sequence above its host high-water mark
    And confirmation reserves that exact sequence before the action is sent
    And an unknown result cannot reuse the sequence
    And an unknown device high-water mark can still refuse the plan

  Scenario: Controller identity changes discard previous observations
    Given a confirmed command awaits its controller acknowledgement
    When the peer, gateway, source generation, telemetry boot, control boot, or key changes
    Then the old action result and physical owner are absent
    And cancellation within the same controller can retain an unknown result
