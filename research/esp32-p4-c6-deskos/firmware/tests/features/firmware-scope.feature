Feature: Open DeskOS firmware scope
  The repository exposes the Open DeskOS product firmware for the Guition
  JC4880P443C P4 board, the compact Waveshare ESP32-S3 board, and the M5Stack
  PaperColor P4 e-paper board.

  Scenario: The product firmware has a product-specific application identity
    Given the Open DeskOS firmware source tree
    When the production application is selected for an ESP-IDF build
    Then its application path is application/open_deskos
    And its ESP-IDF project identity is open_deskos
    And the legacy upstream application path is absent

  Scenario: The production board catalog contains the supported targets
    Given the Open DeskOS production firmware application
    When board-manager definitions are enumerated
    Then exactly three board definitions are available
    And guition/jc4880p443c has board ID jc4880p443c
    And waveshare/esp32_s3_touch_lcd_2_8 has board ID esp32_s3_touch_lcd_2_8
    And m5stack/m5papercolor has board ID m5papercolor
    And no upstream sample firmware application remains
