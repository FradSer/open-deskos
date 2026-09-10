Feature: A calm and precise desk instrument

  Scenario: Today groups date and truthful status without a decorative signal
    Given the local desk shell starts
    When Today is displayed at desktop or compact width
    Then the current weekday and date form one readable group
    And network, focus, and configured-provider status form another readable group
    And all three status statements wrap inside the surface
    And no decorative active-status dot is shown
    And the surface shares the desktop grid edges

  Scenario: Home distinguishes useful values from inactive capabilities
    Given the Home Widgets show local date, time, year progress, and unavailable capabilities
    Then the primary date, time, and percentage remain visually prominent
    And the not-started focus dial uses a quiet neutral outline instead of a filled red progress signal
    And both experimental vision Widgets keep visible names
    And no placeholder capability uses a primary-action appearance

  Scenario: Usage keeps recovery actions beside the status explanation
    Given OpenCode Go is unconfigured or unavailable
    When the user opens Usage in a compact window
    Then the provider state and last-check time form one group
    And refresh and navigation help appear before optional metric details
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
    Then Today, Home, Pi Sessions, Usage, Your apps, and built-in App views remain available
    And direct keyboard, touch, and Remote navigation retain their established boundaries
    And the desktop footprint and compact scrolling remain unchanged
