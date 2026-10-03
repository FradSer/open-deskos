Feature: Quiet Pi session inspection
  Scenario: Search and goals lead the session App
    Given the Pi App contains the scanner fixture sessions
    When I inspect its header and session list
    Then a compact Refresh icon button sits beside Pi Sessions without a LOCAL badge
    And the labeled search input sits in the header row to the left of Refresh
    And the app displays all sessions across folders by default
    And running sessions display working in labels and badges
    And the process details button and disclosure are removed
    And goals remain prominent while status and elapsed time remain visible without raw PID tags

  Scenario: Refresh preserves inspection context
    Given I expanded process details and modified files and focused their controls
    When the scanner returns identical rendered session content
    Then the existing session DOM, disclosures, focus, and scroll position remain unchanged
    When formatted elapsed time changes on a subsequent refresh
    Then keyed disclosures, focused control, and scroll position are restored
    And a different process reusing a PID does not inherit disclosure state
    And sessions without a UUID can retain context using their id
