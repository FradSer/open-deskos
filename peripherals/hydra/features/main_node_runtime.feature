Feature: Main-node application runtime lifecycle
  The composition root owns M5 event sampling and reboot lifecycle while MainRuntime
  coordinates the sensor hub, fleet dashboard, pairing, MQTT, and OTA application flow.

  Scenario: The root marks a healthy OTA image only once after the health window
    Given a freshly flashed main-node image is pending verification
    And the root has not marked it valid
    When the loop time is before the OTA health window
    Then the root does not mark the image valid
    When the loop time reaches the OTA health window
    Then the root marks the image valid
    And later loop passes do not mark it again

  Scenario: MainRuntime consumes a pre-sampled front button event
    Given the runtime is showing the environment page
    When the root supplies a front-click event
    Then the runtime changes to the fleet page

  Scenario: MainRuntime requests restart after a successful OTA
    Given a newer valid main-node OTA command is received
    When the firmware image is flashed successfully
    Then the runtime returns a restart outcome to the root
    And the root performs the restart lifecycle

  Scenario: MainRuntime publishes unavailable environment on its normal cadence
    Given MQTT is enabled
    And the PaHub or environment sensor did not initialize
    When the environment publication cadence elapses
    Then the runtime publishes the invalid MQTT environment snapshot and heartbeat
    But it does not broadcast an invalid ESP-NOW environment frame

  Scenario: A prolonged Wi-Fi outage escalates to a device restart
    Given the main node has neither Wi-Fi nor an MQTT session
    When the outage reaches the Wi-Fi nudge threshold
    Then link recovery requests one Wi-Fi reconnect nudge
    When the outage reaches the radio restart threshold
    Then link recovery requests one bounded radio restart
    When connectivity is still unavailable at five minutes
    Then link recovery requests a full device restart

  Scenario: A prolonged broker-only outage also escalates to a device restart
    Given Wi-Fi remains associated but MQTT cannot reconnect
    When the outage reaches the radio restart threshold
    Then link recovery requests one bounded radio restart
    When connectivity is still unavailable at five minutes
    Then link recovery requests a full device restart

  Scenario: Connectivity recovery resets after a healthy MQTT session
    Given recovery escalation has begun
    When Wi-Fi and MQTT become connected
    Then the outage deadline and escalation steps reset
    And a later outage receives a fresh bounded recovery window

  Scenario: Radio restart recovery preserves the ESP-NOW fleet link
    Given link recovery asks MainRuntime to restart the Wi-Fi radio
    When MainRuntime performs the bounded restart
    Then it releases ESP-NOW before cycling the Wi-Fi driver
    And it reinitializes ESP-NOW on the recovery channel afterward
    And an ESP-NOW reinitialization failure requests a full device restart
