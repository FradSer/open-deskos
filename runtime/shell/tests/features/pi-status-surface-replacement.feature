Feature: Preserve Pi status behavior through plugin lifecycle changes

  Scenario: Remounted status publishes through the selected briefing service
    Given a default, independent, or restored Pi status consumer in the actual Shell
    When the briefing service changes and the status remounts
    Then working, settled, and unavailable scans publish unchanged statements through the selected service
    And the deselected default store retains its last statement
    And disable releases status Tick ownership without deleting the retained statement
    And restoration publishes current readings through the default store
    And acceptance rejects a consumer that bypasses service selection

  Scenario: Released status consumers ignore pending scans
    Given the Pi State Bar consumer has a pending scan
    When its selected factory is disabled or replaced
    Then shared Tick subscription cleanup completes
    And a late scan success or rejection cannot update released nodes or publish another briefing
    And the released button cannot navigate to Home or focus the Pi Sessions Widget

  Scenario: Replacement owns the retained consumer after an earlier scan completes
    Given the default Pi State Bar consumer has a pending scan
    When the independent implementation replaces it in the same container
    And the independent scan publishes its reading
    Then a late default scan success or rejection cannot overwrite that reading or its briefing
    And exactly one shared Tick subscription belongs to the selected implementation

  Scenario: Independent status displays the same session meaning
    Given default and independent status implementations consume the same scan responses
    When responses contain working, settled, empty, unavailable, or missing summaries
    Then count, activity classes, source labels, accessible names, and briefing parts agree
    And the scan cadence remains one initial request and one request per three shared Ticks

  Scenario: Actual browser loading preserves the State Bar and recovery
    Given a private Shell uses the actual preload and a controlled Pi scan provider
    And Tick observations start before the initial status mount
    When a trusted development link or signed revision replaces the status through the public controller
    Then actual and comparison consumers retain readings, accessible names, styles, and geometry
    And keyboard activation returns to Home and focuses the Pi Sessions Widget without opening an App
    And disable and enable release and reacquire their Tick subscriptions
    And built-in recovery retains the document and active peer surfaces
    And shutdown releases discovery and asset authority before the child closes

  Scenario: Browser verification rejects incomplete independent behavior
    Given a controlled independent entry omits Tick subscription or navigation
    When it loads through either supported fixture loading mode
    Then the corresponding resource or keyboard check rejects that entry
    And unrelated setup failures cannot count as the expected rejection

  Scenario: Hidden Pi status comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture prepares its comparison document
    Then its renderer viewport is 1920 by 1280 at unit scale before measurement
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And existing state, navigation, lifecycle, and deadline assertions remain required
