Feature: ESP32-S3 small-display board support
  Open DeskOS supports the Waveshare ESP32-S3 Touch LCD 2.8 board as a
  small-screen target. The S3 uses the same LVGL/Lua shell as the P4, but its
  240x320 display is constrained to a 2x2 widget grid.

  Scenario: The Waveshare ESP32-S3 board is discoverable by board manager
    Given the Open DeskOS production firmware board catalog
    When board-manager definitions are enumerated
    Then waveshare/esp32_s3_touch_lcd_2_8 is available
    And its chip is esp32s3
    And its display is a 240x320 ST7789 SPI panel
    And its touch controller is a CST328 on I2C

  Scenario: The S3 shell uses the small-screen widget geometry
    Given an ESP32-S3 display size of 240x320
    When AIODI grid metrics are calculated
    Then the widget grid has 2 columns and 2 rows
    And a widget larger than 2x2 is not placed on the grid
    And the P4 480x800 shell keeps its 3 columns and 4 rows

  Scenario: The S3 Dashboard uses compact typography
    Given an ESP32-S3 Dashboard canvas of 240x320
    When the daily narrative layout is validated
    Then the Dashboard uses compact text metrics
    And every compact narrative row fits within the available height

  Scenario: The S3 panel power latch and backlight are enabled before LVGL
    Given the Waveshare S3 panel power latch uses GPIO7 and GPIO6 is its key input
    When the display bring-up starts
    Then GPIO6 is configured as an input before it is sampled
    And GPIO7 is asserted to keep the panel power latch enabled
    And the GPIO5 backlight is driven at full active-high brightness
    And the panel is cleared before the backlight is enabled
