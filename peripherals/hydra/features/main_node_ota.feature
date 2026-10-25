Feature: Main-node self OTA command
  The main node receives an OTA trigger over MQTT (from the NAS) and pulls the new
  firmware binary over HTTP, flashes it to the standby partition with esp_ota, and
  reboots. The MQTT payload is a small text record; the app layer parses it into an
  OtaCommand and decides whether to apply it (only a strictly higher version is
  applied). A SHA mismatch or a malformed payload must never flash.

  Scenario: A well-formed OTA command parses to its fields
    When the payload is "v=5;size=327680;sha=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20;url=http://nas/hydra/main.bin"
    Then the parsed version is 5
    And the parsed bin size is 327680
    And the parsed sha256 is 0102...1f20
    And the parsed url is http://nas/hydra/main.bin
    And the command is valid

  Scenario: A maximum-length OTA URL survives MQTT ingress
    Given an OTA command whose URL fills the parser's bounded URL field
    And the complete command is longer than 128 bytes
    When the MQTT callback stores the command for MainRuntime
    Then the bounded ingress payload holds the complete command and its terminator
    And the OTA command parser accepts the maximum-length URL without truncation

  Scenario: A higher version applies
    When the command version is 5 and the current version is 3
    Then the OTA should be applied

  Scenario: An equal or lower version is ignored
    When the command version is 3 and the current version is 3
    Then the OTA should not be applied

  Scenario: A payload missing a field is invalid
    When the payload is "v=5;size=327680;url=http://nas/hydra/main.bin"
    Then the command is invalid

  Scenario: A payload with a bad sha hex is invalid
    When the payload is "v=5;size=327680;sha=zz;url=http://nas/hydra/main.bin"
    Then the command is invalid

  Scenario: A payload with a sha of the wrong length is invalid
    When the payload is "v=5;size=327680;sha=0102;url=http://nas/hydra/main.bin"
    Then the command is invalid

  Scenario: Shared LAN transfer accepts only HTTP URLs
    Given a LAN firmware URL using http with an explicit port and path
    When the shared OTA transfer parses it
    Then it uses that host, port, and path
    But an https URL is rejected because the firmware uses a non-TLS WiFiClient

  Scenario: Shared OTA transfer validates announced and Content-Length sizes
    Given an announced firmware size and a different HTTP Content-Length
    When the shared OTA transfer plans the download
    Then it rejects the transfer before flashing

  Scenario: Sub-OTA URL parser rejects overflowing numeric tokens
    Given an HTTP sub-OTA URL with an extremely long decimal octet or port
    When the main node parses it for an announcement
    Then it rejects the URL before broadcasting or persisting a campaign sequence

  Scenario: OTA command parser rejects overflowing u32 metadata
    Given an OTA command whose version or size is 4294967296 or an extremely long decimal string
    When the main node parses the command
    Then the command is invalid
