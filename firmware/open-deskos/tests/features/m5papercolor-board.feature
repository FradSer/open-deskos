Feature: M5Stack PaperColor board support
  Open DeskOS supports the M5Stack PaperColor board as an ESP32-S3 e-paper
  target. The PaperColor uses an ED2208 400x600 reflective e-paper panel,
  an M5PM1 PMIC on I2C for power management, and physical buttons without
  touch input.

  Scenario: The M5Stack PaperColor board is discoverable by board manager
    Given the Open DeskOS production firmware board catalog
    When board-manager definitions are enumerated
    Then m5stack/m5papercolor is available
    And its chip is esp32s3
    And its display is a 400x600 ED2208 e-paper panel
    And it uses the M5PM1 PMIC on I2C for power sequencing

  Scenario: The PaperColor uses direct display bring-up and IO panel interface
    Given an ESP32-S3 build with CONFIG_ODK_BOARD_M5PAPERCOLOR enabled
    When display bring-up starts
    Then the M5PM1 PMIC powers on the EPD rail on PM1 GPIO0
    And the ED2208 e-paper controller is initialized on SPI
    And the panel interface is set to PANEL_IF_IO
    And the display refresh period is throttled for e-paper

  Scenario: The PaperColor dashboard uses a safe text inset
    Given a PaperColor 400x600 dashboard canvas
    When the homepage narrative is rendered
    Then the dashboard content has a 24 pixel side safety inset
    And the first word is not clipped by the panel bezel

  Scenario: The PaperColor buttons navigate homepage pages
    Given the PaperColor homepage is visible
    When the left or right physical button is clicked
    Then the pager moves one page in the corresponding direction
    And the pager remains within the available page range
