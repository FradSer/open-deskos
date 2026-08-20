Feature: AIODI home page grid layout
  Home pages use the same 3x4 cell geometry, equal gutters, and fixed page
  bounds as Homepage / #1. Provider content may span cells, but may not size
  itself from unconstrained content height.

  Scenario: Homepage #2 quota widgets stay inside the shared grid
    Given the launcher displays Homepage / #2 at 480x800
    When the Ark and Claude quota widgets are rendered
    Then both provider groups occupy explicit cells from the Homepage / #1 grid
    And every meter is sized from the grid cell geometry
    And no quota widget overlaps another widget or escapes the page bounds

  Scenario: Page indicator remains centered and touchable
    Given the launcher displays a three-page home pager
    When the status bar is rendered at 480x800
    Then the page indicator is centered in the status bar
    And each page marker has a stable touch area larger than its visible marker
    And the visible gaps between adjacent page markers are equal
