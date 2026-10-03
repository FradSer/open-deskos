Feature: A calm and precise desk instrument

  Scenario: Today groups the date with plugin-contributed statements
    Given the local desk shell starts
    When Today is displayed at desktop or compact width
    Then the current weekday and date form one readable group
    And every contributed briefing statement wraps inside the surface
    And statement signals and their icons are emphasized while connectives stay quiet
    And no decorative active-status dot is shown
    And the surface shares the desktop grid edges

  Scenario: Home distinguishes useful values from inactive capabilities
    Given the Home Widgets show local date, time, year progress, and unavailable capabilities
    Then the primary date, time, and percentage remain visually prominent
    And the not-started focus dial uses a quiet neutral outline instead of a filled red progress signal
    And both experimental vision Widgets keep visible names
    And no placeholder capability uses a primary-action appearance

  Scenario: Usage keeps recovery actions in its compact header
    Given OpenCode Go is unconfigured or unavailable
    When the user opens Usage in a compact window
    Then the last-check time and refresh action appear beside the page title in one compact header
    And the header controls appear before optional metric details
    And no redundant navigation help is rendered
    And empty-state prose is separated from numerical metrics
    And no redundant provider badge is rendered
    When the user requests a refresh
    Then the refresh action exposes a busy state until the request settles
    And the original button label and dimensions are preserved

  Scenario: Input modality determines pager motion
    Given motion is allowed and the pager is ready
    When the user changes pages with a keyboard shortcut or Remote input
    Then the destination is visible immediately without a slide transition
    When a pointer selects a page indicator
    Then the pager uses an interruptible transition no longer than 250 milliseconds
    And page indicators animate only transform and color rather than width
    When reduced motion is requested
    Then paging and press feedback have no movement animation

  Scenario: Design refinement preserves the shell contract
    Given every provider and peripheral is unavailable
    Then Today, Home, Reading, Pi Sessions, Usage, and built-in App views remain available
    And direct keyboard, touch, and Remote navigation retain their established boundaries
    And the desktop footprint and compact scrolling remain unchanged
