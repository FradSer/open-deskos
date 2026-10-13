Feature: Responsive summary widget interiors
  Scenario: Pomodoro readings stay centered in their dial
    Given Home uses a square Pomodoro Widget in any supported theme
    When the window changes between compact and widescreen sizes
    Then the countdown shares the center of the dial and Widget
    And the Focus label stays inside the dial below the countdown
    And the truthful state remains centered above the dial

  Scenario: Resize applies placement after the new grid metrics
    Given the desktop keeps multi-cell Widget spans in a wide window
    When a hidden window resizes to a compact grid
    Then placement uses the new cell dimensions and grid lines in the same geometry update
    And obsolete wide spans cannot remain because an observer ran before that update

  Scenario: Pre-order remains readable in a compact square
    Given Home is rendered at 480 by 854 in every supported theme
    When the countdown has three day digits or has opened
    Then all countdown and launch-label text remains inside the tile
    And the product image retains visible space

  Scenario: Session summaries remain legible without detailed activity
    Given Pi Sessions has idle or live summary counts without session details
    When Home is rendered at compact or widescreen sizes
    Then the primary count and truthful summary form a balanced readable instrument
    And its content passes the established density profile

  Scenario: An unconfigured reading tile uses its available space
    Given WeRead has no configured account
    When Home is rendered at 1920 by 1280
    Then the configuration message remains truthful and readable
    And its content passes the established density profile
