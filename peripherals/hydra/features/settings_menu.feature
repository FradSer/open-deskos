Feature: Settings menu on the main node
  As a home gardener operating the main node with two buttons
  I want a settings menu holding network setup and sub-node pairing
  So that long-press reaches every configuration task, not just pairing

  # Long-press of the front button (BtnA) opens the menu (it previously jumped
  # straight to pairing). The side button (BtnB) moves the selection, a short
  # front press confirms it, and another long press cancels back to the
  # environment page. Menu entries, in order: Network, Pairing.

  Scenario: Long-pressing the front button opens the settings menu
    Given the main node is showing the environment page
    When the front button is held
    Then the settings menu is shown with Network selected

  Scenario: The menu also opens from the fleet page
    Given the main node is showing a sub-node page
    When the front button is held
    Then the settings menu is shown with Network selected

  Scenario: The side button cycles the menu selection
    Given the settings menu is shown with Network selected
    When the side button is pressed
    Then Pairing is selected
    When the side button is pressed again
    Then Network is selected again

  Scenario: Confirming Pairing opens the pairing page
    Given the settings menu is shown with Pairing selected
    When the front button is pressed
    Then the pairing page is shown

  Scenario: Confirming Network reruns the setup portal
    Given the settings menu is shown with Network selected
    When the front button is pressed
    Then the node enters network setup
    And the captive portal runs as on first boot, restarting afterwards

  Scenario: Long press in the menu cancels back to the environment page
    Given the settings menu is shown
    When the front button is held
    Then the environment page is shown

  # The boot-time entries are unchanged: first boot with nothing provisioned, or
  # the side button held at power-on, still enter the portal directly
  # (features/wifi_provisioning.feature).
