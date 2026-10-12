Feature: Replace static desk tool surfaces without changing behavior

  Scenario: Authenticated desk tool activation preserves production consumers
    Given production Main runs every plugin with private state and controlled external inputs
    When the CLI activates signed Settings, Chatbot, and Pomodoro surfaces and restores their built-in implementations
    Then the same actual containers preserve state text, display-only behavior, and static artwork
    And selected entry markers and default mount guards identify independent execution
    And shared Tick ownership, foreground navigation, peer ports, and saved selections remain unchanged
    And normal shutdown releases handlers, signed routes, subscriptions, and private listeners

  Scenario: Independent surfaces preserve the current product state
    Given Settings and Chatbot report pending integration and Pomodoro reports not started
    When independently constructed surfaces replace their built-in definitions
    Then their names, state text, static artwork, placement contracts, and display-only behavior remain unchanged
    And they acquire no provider, Tick, connection, or input subscriptions

  Scenario: Lifecycle changes preserve other desk surfaces
    Given either built-in or independent desk tool surfaces run in the Shell
    When each tool is disabled and enabled through the public runtime controller
    Then its selected implementation returns with the same displayed state
    And the other tool containers and selected implementations remain active
    And restoring defaults keeps the document and active tool containers

  Scenario: Actual development and signed loaders execute the independent definitions
    Given a private Shell fixture uses actual preload and trusted plugin discovery
    When linked or signed desk tool entries replace and restore the three surfaces
    Then the actual desktop and comparison consumers execute the selected revisions
    And three themes and three Cell sizes preserve rendered readings and static artwork
    And shutdown releases discovery and signed asset authority before the child process closes

  Scenario: Dependency checks survive registry context adaptation
    Given both actual desktop and comparison mounts receive the scoped registry context
    When a controlled independent entry attempts an optional connection subscription
    Then acceptance rejects the entry in development and signed loading modes
    And the initiating context violation remains observable before fixture cleanup

  Scenario: Hidden static tool comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture prepares its comparison document
    Then its renderer viewport is 1920 by 1280 at unit scale before measurement
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And existing comparisons, dependency guards, and deadlines remain required
