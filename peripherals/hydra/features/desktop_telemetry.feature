Feature: Read-only desktop telemetry through the shared encrypted gateway
  Scenario: The main node sends bounded application telemetry
    Given private NVS selects one encrypted gateway and a fixed fleet channel
    When the main node samples its environment and receives a plant report
    Then it sends hello, environment, and plant JSON frames of at most 250 bytes
    And one boot identity and increasing sequence identify all frames
    And the plant measurement age remains tied to its actual report
    And frame pacing preserves the local fleet loop

  Scenario: Missing configuration and invalid sensors remain honest
    Given the main node has no valid private gateway configuration
    Then it sends no desktop telemetry and the local fleet remains available
    When sensors or the clock are unavailable
    Then telemetry does not invent measurements or trusted time

  Scenario: The desktop profile does not connect to a network
    Given the default main-node build is active
    And no independent desktop control key is configured
    Then Wi-Fi association, MQTT, network provisioning, HTTP OTA, and network fallback are disabled
    And the main node retains physical controls and the existing fleet protocol
    And no desktop pump, credential, OTA, or raw fleet command is accepted

  Scenario: A missing host callback cannot delay physical fleet control
    Given a desktop send has no completion callback
    When the main node sends a physical pump or spotlight command
    Then the fleet command is submitted immediately without an application queue
    And the host path stops after its bounded timeout without replaying a command

  Scenario: Generic encrypted requests cannot enter the old fleet decoder
    Given the desktop profile receives a unicast raw fleet frame
    Then it discards the frame before the legacy fleet decoder
    And legitimate broadcast fleet reports retain their existing behavior

  Scenario: Explicit private provisioning preserves existing device settings
    Given the ordinary main build has a private header beside its source
    Then it ignores that header and opens host configuration read-only
    When an explicit private build provisions its approved configuration
    Then only the hydra-host namespace changes
    And incomplete writes leave its commit marker invalid
    And existing fleet identities and other namespaces remain unchanged
