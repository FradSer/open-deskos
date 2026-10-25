Feature: Sub-node application runtime lifecycle
  The composition root samples NanoC6 button events and owns restart lifecycle while
  SubRuntime coordinates irrigation, pairing, channel recovery, telemetry, and OTA flow.

  Scenario: The root marks a healthy OTA image only once after the health window
    Given a freshly flashed sub-node image is pending verification
    And the root has not marked it valid
    When the loop time is before the OTA health window
    Then the root does not mark the image valid
    When the loop time reaches the OTA health window
    Then the root marks the image valid
    And later loop passes do not mark it again

  Scenario: SubRuntime consumes a pre-sampled button hold
    Given a paired sub-node with automatic irrigation enabled
    When the root supplies a held-button event
    Then the runtime starts local force watering
    When the root supplies a released-button event
    Then the runtime releases local force watering

  Scenario: SubRuntime returns restart after a verified OTA image
    Given a newer valid sub-node OTA announcement
    When its downloaded image verifies and is marked bootable
    Then the runtime tears down associated Wi-Fi before returning a restart outcome
    And the root performs the restart lifecycle

  Scenario: A failed OTA restores ESP-NOW instead of restarting
    Given a sub-node OTA transaction has torn down Wi-Fi and ESP-NOW
    When the firmware transfer fails
    Then the runtime reinitializes ESP-NOW
    And it does not return a restart outcome

  Scenario: A stale environment broadcast invalidates the irrigation clock
    Given the runtime last received a valid environment broadcast
    When its environment staleness window elapses before the periodic irrigation tick
    Then it invalidates the cached clock before it ticks the irrigation controller
    And a fresh environment broadcast later restores the clock

  Scenario: Remote force watering times out before an automatic controller tick
    Given the main node has forced a paired sub-node pump on
    When no force keep-alive arrives for the remote-force timeout
    Then the runtime releases remote force watering before its periodic irrigation tick
    And it does not re-enable the force owner on a later automatic tick

  Scenario: An unpaired sub-node preserves its runtime force state after radio initialization fails
    Given ESP-NOW initialization fails during boot
    When the runtime begins with the root's zeroed MAC
    Then it stays unpaired and does not replace its runtime identity from NVS
