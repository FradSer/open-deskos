Feature: Wi-Fi provisioning portal on the main node
  As a home gardener setting up Hydra
  I want to configure Wi-Fi and the MQTT broker from my phone
  So that no credentials are ever compiled into the firmware

  # The main node provisions itself through a SoftAP captive portal: it broadcasts
  # the "Hydra-Setup" access point, the phone joins it and a web form collects the
  # home Wi-Fi credentials plus the NAS broker address. Wi-Fi credentials persist
  # in the radio's own NVS; the broker address in the hydra-net namespace.
  # Provisioning never gates watering -- sub-nodes are autonomous regardless.

  Scenario: First boot with nothing provisioned enters setup mode
    Given no Wi-Fi credentials and no broker address are stored
    When the main node boots
    Then it enters the setup portal instead of normal operation

  Scenario: A provisioned node boots straight to normal operation
    Given Wi-Fi credentials and a broker address are stored
    When the main node boots
    Then it skips the portal and starts the dashboard and the HomeKit bridge

  Scenario: Holding the side button at power-on forces re-provisioning
    Given Wi-Fi credentials and a broker address are stored
    When the main node boots with the side button held
    Then it enters the setup portal to collect new settings

  Scenario: Saving the portal form stores the settings and restarts
    Given the setup portal is showing
    When the form is saved with valid Wi-Fi credentials and a broker address
    Then the broker address is persisted
    And the node restarts into normal operation

  Scenario: The portal times out into offline operation
    Given the setup portal is showing
    When nobody completes the form within the timeout
    Then the node continues without the HomeKit bridge
    And the fleet dashboard still works

  Scenario: The broker address is cleaned before being stored
    Given a broker address entered with surrounding spaces
    When the address is sanitized
    Then the stored value has no surrounding whitespace
    And an address that is empty or only spaces is rejected
