Feature: Independent calendar and State Bar time surfaces
  Calendar and time surfaces retain their current public behavior after replacement.

  Scenario: Authenticated time surface activation preserves production consumers
    Given production Main runs all plugins with private state and controlled external inputs
    When the CLI activates signed Almanac, Year, and State Bar Clock entries and restores their built-in implementations
    Then the same actual containers preserve readings across leap day and year boundaries
    And the selected entries execute without default mount delegation
    And shared Tick ownership, foreground navigation, and peer ports remain unchanged
    And shutdown releases subscriptions, handlers, protocol routes, and private listeners

  Scenario: Almanac preserves local calendar transitions
    Given default and independent Almanac surfaces receive equal local Date values
    When the date crosses midnight, a month boundary, leap day, or a year boundary
    Then weekday, day, month, and numeral classes remain equal
    And repeated readings on the same local date do not rewrite the display

  Scenario: Year preserves elapsed local-year progress
    Given default and independent Year surfaces receive equal local Date values
    When elapsed time crosses leap day or approaches the next year
    Then the rounded percentage and precise meter width remain equal
    And the wide numeral class follows the same rounding boundary
    And unchanged readings do not rewrite the percentage or meter

  Scenario: State Bar Clock preserves its shared Tick contract
    Given default and independent State Bar Clock surfaces occupy the right slot
    When local time crosses midnight or moves backward
    Then both surfaces show the same padded local hours and minutes
    And every supplied Tick retains the existing display update behavior

  Scenario: Time surface release retains failed ownership
    Given each surface owns one shared Tick subscription beside an independent peer
    When subscription release fails
    Then the failed surface retains ownership and refuses a new mount
    And retry, disable, enable, and built-in recovery preserve the current reading

  Scenario: Trusted entries preserve calendar and State Bar consumers
    Given a private Shell can load development links or signed time surface packages
    When the public Renderer controller replaces and restores all three surfaces
    Then the same document and actual containers use the selected implementations
    And actual shared Ticks update all consumers after controlled date changes
    And three themes preserve rendered text, classes, styles, and geometry
    And final shutdown releases subscriptions, discovery, and signed assets before process closure

  Scenario: Hidden calendar comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture prepares its comparison document
    Then its renderer viewport is 1920 by 1280 at unit scale before measurement
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And the existing comparisons, Tick assertions, and deadlines remain required

  Scenario: Hidden production comparison owns a render target
    Given production Main runs a hidden comparison window
    When the fixture compares calendar, tool, and Pre-order rendering
    Then the window retains production preferences and an offscreen render target
    And the fixture restores the module loader after Main loads

  Scenario: Native combined comparison has a bounded workload budget
    Given Linux arm64 runs Clock, calendar, tools, and Pre-order comparisons in one process
    When the comparison observes shared Tick transitions and signed activation
    Then its fixture has a sixty-second deadline inside its parent watchdog
    And other hosts and shorter Clock modes retain their existing deadlines
