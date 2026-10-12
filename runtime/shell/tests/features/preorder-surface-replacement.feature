Feature: Pre-order surface replacement ownership
  Scenario: Authenticated activation preserves the production Pre-order consumer
    Given production Main runs every plugin with private state and controlled external inputs
    When the CLI activates a signed Pre-order surface and restores its built-in implementation
    Then the same actual container preserves countdown, opening state, caption, and canvas pixels
    And selected entry markers and default mount guards identify independent execution
    And shared Tick ownership, saved selections, foreground navigation, and peer ports remain unchanged
    And normal shutdown releases subscriptions, handlers, signed routes, and private listeners

  Scenario: Independent rendering preserves the existing display contract
    Given default and independent Pre-order surfaces use the same time and artwork
    When the shared Tick changes before and after the opening time
    Then both surfaces display the same countdown and opening state
    And the independent surface does not call the default mount
    And both preserve the artwork focus crop and partial Pixel blocks

  Scenario: Pixel buffer rejection preserves the standard artwork
    Given a Pixel Pre-order surface has loaded its hero image
    When pixel buffer access fails
    Then the standard image remains drawn
    And the callback does not fail

  Scenario: A released surface ignores a pending image
    Given the Pre-order surface has requested its hero image
    When the surface is disabled before the image finishes
    Then its Tick subscription is released
    And the image completion does not change its released canvas

  Scenario: A released surface ignores a captured Tick callback
    Given the Pre-order surface displays the countdown
    When the surface is disabled
    And a captured Tick callback runs after the opening time
    Then its released countdown remains unchanged
    And it does not request another hero image

  Scenario: Surface unmount keeps a running factory isolated from released work
    Given the Pre-order surface has pending image and Tick callbacks
    When only its surface is unmounted
    Then both callbacks leave the released surface unchanged
    And its Tick subscription is released

  Scenario: Failed Tick release remains fenced and retryable
    Given a Pre-order Tick subscription fails to release
    When its surface unmount reports the failure
    Then pending callbacks leave the released surface unchanged
    And another unmount retries the unfinished subscription release

  Scenario: External loading preserves canvas and countdown consumers
    Given development and signed independent Pre-order entries use private profiles
    When each entry replaces the default surface in the same Shell document
    Then three themes and three actual viewports preserve countdown and canvas pixels
    And displayed text stays inside its surface at the supported text floor
    And disable and enable preserve the independent Year surface
    And the default surface can be restored
    And discovery and asset authority release before the window closes

  Scenario: Replacement guards reject missing subscriptions and Pixel processing
    Given a controlled entry omits its Tick subscription or Pixel processing
    When the entry loads through development or signed discovery
    Then the corresponding resource or pixel guard rejects it
    And an unrelated loading failure does not count as guard evidence

  Scenario: Hidden Pre-order comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture selects each existing comparison size
    Then its renderer viewport matches that size at unit scale before layout settles
    And offscreen rendering supplies frames without showing the window
    And canvas, countdown, resource, recovery, and deadline assertions remain required
