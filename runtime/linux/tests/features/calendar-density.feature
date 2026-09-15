Feature: Calendar density across real dates
  Scenario: A narrow day numeral remains a readable Pixel instrument
    Given the local date is January 1, 2026
    And the Pixel theme is active
    When Home renders at each supported window size
    Then Calendar shows Thursday, day 1, and January without fabricated padding digits
    And its genuine text meets the existing Calendar density profile without clipping
