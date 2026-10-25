Feature: OtaAnnounce frame builder
  The main node broadcasts an OtaAnnounce over ESP-NOW whenever a new firmware is
  available, so sub-nodes can decide whether to fetch and flash it. The frame
  carries only metadata (version, size, SHA-256, the main node's HTTP ip:port, and
  a monotonic seq); the bin and Wi-Fi credentials are NOT on the wire. The builder
  is the single construction point, host-tested like the other fleet builders.

  Background:
    Given the fleet protocol version is 6

  Scenario: An OtaAnnounce carries the version, size, sha, ip, port and seq
    When the main node builds an OtaAnnounce for v=7, size=131072, sha=00...01, ip=192.168.1.10, port=8080, seq=42
    Then the frame type is OtaAnnounce
    And the otaVersion is 7
    And the otaBinSize is 131072
    And the otaSha256 is 00...01
    And the otaIp is 192.168.1.10
    And the otaPort is 8080
    And the otaSeq is 42

  Scenario: Unused payload fields stay zero on an OtaAnnounce
    When the main node builds an OtaAnnounce
    Then the env fields are zero
    And the soil fields are zero
    And the command fields are zero

  Scenario: A failed OTA finish aborts its active flash session exactly once
    Given a sub-node OTA flash session is active
    When SHA verification or esp_ota_end fails during finish
    Then the flash session is aborted
    And a later caller abort does not abort it again

  Scenario: Boot-partition failure does not abort a finalized OTA session
    Given esp_ota_end has finalized the sub-node OTA flash session
    When marking the standby partition bootable fails
    Then finish reports failure
    And no active flash session remains to abort

  Scenario: A sub-node without Wi-Fi credentials declines OTA without restarting radio
    Given a sub-node receives a newer OTA announcement without stored Wi-Fi credentials
    When it starts the OTA transaction
    Then it resumes normal irrigation and ESP-NOW without reinitializing the radio

  Scenario: Both node types use bounded stall-guarded OTA transfer
    Given an announced firmware size and an HTTP stream that stops progressing
    When either node transfers the firmware over LAN HTTP
    Then no more than the announced size is written
    And the active OTA writer is aborted once after the stall timeout

  Scenario: A failed sub-node OTA restores a released ESP-NOW transport
    Given a sub-node begins OTA with stored Wi-Fi credentials
    When it releases ESP-NOW before Wi-Fi is turned off
    And the firmware transfer fails
    Then radio recovery initializes ESP-NOW without a forced restart
    But a sub-node without Wi-Fi credentials does not release or reinitialize ESP-NOW
