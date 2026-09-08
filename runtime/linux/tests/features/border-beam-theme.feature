Feature: Optional Border Beam theme
  Scenario: Preserve the original appearance
    Given no saved theme preference
    When the shell starts
    Then the Instrument theme is selected
    And the status bar contains no theme switcher

  Scenario: Choose and restore Border Beam
    Given the shell is running
    When Border Beam is selected through the theme API
    Then the theme is applied without changing page content or navigation
    And my choice is restored on the next launch

  Scenario: Unavailable preference storage
    Given browser preference storage is unavailable
    When Border Beam is selected through the theme API
    Then the theme still works for the current session

  Scenario: Accessible edge motion
    Given Border Beam is selected
    When reduced motion is requested or the document is hidden
    Then edge animation stops
    And decorative layers never intercept input
