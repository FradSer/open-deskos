Feature: ESP-NOW data validation through the C6 custom-data bridge
  The Open DeskOS P4 uses the board's ESP32-C6 as an ESP-NOW radio
  co-processor. The C6 forwards the original Hydra FleetMessage payload over
  ESP-Hosted custom data, while the P4 validates, classifies, and records the
  received sensor frames without starting Wi-Fi application services or UI
  bindings.

  Scenario: P4 starts the C6 custom-data bridge without Wi-Fi
    Given no Wi-Fi access point, SSID, password, or LLM endpoint is available
    When the P4 application starts
    Then the serial log reports "C6 transport ready"
    And the serial log reports "C6 custom-data bridge ready"
    And the serial log reports "ESP-NOW validator ready"
    And no Wi-Fi application service is started

  Scenario: An environment broadcast is decoded without changing its payload
    Given the C6 receives a Hydra EnvBroadcast payload
    When the C6 forwards the payload over custom data
    Then the P4 accepts the original payload bytes
    And the P4 reports the environment node temperature, humidity, pressure, lux, VPD, and time fields
    And the environment frame counter increases by one

  Scenario: Two flower status reports remain separately attributable
    Given the C6 receives valid StatusReport payloads from flower nodes 1 and 2
    When the P4 consumes both custom-data frames
    Then the P4 records one status frame for node 1
    And the P4 records one status frame for node 2
    And each node retains its own MAC, soil raw value, soil percentage, validity, and status fields

  Scenario: A valid Hydra frame preserves its payload across the bridge
    Given a valid Hydra FleetMessage payload shorter than 250 bytes
    When the C6 forwards the frame to the P4
    Then the P4 receives the same payload length
    And the P4 receives the same payload bytes in the same order

  Scenario: A truncated frame is rejected without crashing the validator
    Given a custom-data frame shorter than the known Hydra protocol prefix
    When the P4 validator consumes the frame
    Then the frame is counted as malformed
    And no node cache or valid frame counter changes
    And the validator task continues running

  Scenario: An old protocol version is rejected
    Given a Hydra frame with a protocol version older than the supported version
    When the P4 validator consumes the frame
    Then the frame is counted as malformed
    And the frame is not classified as environment or status data

  Scenario: An unknown message type is rejected
    Given a frame with a supported header version and an unknown Hydra message type
    When the P4 validator consumes the frame
    Then the frame is counted as an unknown type
    And no node cache is updated

  Scenario: Validation continues without network services
    Given the P4 has no Wi-Fi association, MQTT broker, HTTP server, or LLM connection
    When the validator runs for ten minutes
    Then it continues consuming C6 custom-data frames
    And it does not start a Wi-Fi access point or station connection
    And it does not crash when a sensor node is absent

  Scenario: Missing C6 transport cannot reboot the P4
    Given the C6 slave is absent or fails the ESP-Hosted handshake
    When the asynchronous transport probe reports a failure
    Then the P4 keeps the launcher running
    And the host transport does not restart the P4

  Scenario: A manually selected channel is applied to the C6
    Given the validator is running on channel 1
    When the console command "cerb now channel 6" is received
    Then the P4 sends a channel-6 control command to the C6
    And the C6 reports channel 6 as its active channel
    And a valid frame received on channel 6 is accepted

  Scenario: A full receive queue drops frames without blocking the radio callback
    Given the P4 or C6 receive queue is full
    When an ESP-NOW callback receives another frame
    Then the callback returns without performing custom-data I/O or blocking
    And the dropped-frame counter increases
    And frames already in the queue remain available to the consumer
