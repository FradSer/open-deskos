Feature: Independent Clock surface replacement
  Clock replacements preserve local time and Shell resource ownership.

  Scenario: Default and independent Clock surfaces share time behavior
    Given the Clock receives the same local Date values through the shared Tick
    When time crosses a minute, midnight, or moves backward
    Then both surfaces display the same padded local hours and minutes
    And the time element retains the same machine-readable value
    And repeated readings do not rewrite the time element

  Scenario: Clock replacement preserves subscription ownership
    Given a Clock surface is mounted beside an independent peer
    When its subscription release fails once
    Then a new mount cannot start over the retained subscription
    And a later release retries the failed cleanup
    And disable and enable create one fresh subscription

  Scenario: Trusted Clock entries preserve rendered behavior without navigation
    Given a private Shell loads a development or signed independent Clock entry
    When the public Renderer controller selects the entry and restores the built-in Clock
    Then the same document and desktop container display equal controlled local time
    And three themes retain the same computed styles and geometry
    And shutdown releases discovery and surface resources before process closure

  Scenario: Authenticated Clock activation preserves the production Shell
    Given production Main enables every plugin with private state and controlled external inputs
    And the Shell starts with a built-in or signed Clock surface
    When the CLI activates signed Clock revisions and restores the built-in Clock
    Then the same document and desktop placement display compatible time in all three themes
    And the shared Tick retains the same number of subscriptions
    And foreground navigation and peer ports remain available
    And recovery works with malformed external configuration and revoked publisher trust
    And shutdown releases subscriptions, protocol routes, handlers, and private listeners

  Scenario: Selected Renderer control preserves signed activation and restoration
    Given production Main selects the alternative control channel through a trusted development link
    And the Shell starts with a built-in or signed Clock surface
    When the existing CLI activates signed Clock revisions and restores the built-in Clock
    Then the same Clock behavior, shared Tick ownership, foreground, and peer ports remain available
    And recovery preserves malformed configuration and revoked publisher trust
    And a missing selected control implementation fails the startup guard
    And shutdown removes the control report listener and private endpoint

  Scenario: Production Clock acceptance rejects an implementation without Tick ownership
    Given a signed Clock candidate omits its Tick subscription
    When the same production activation and comparison path runs
    Then the subscription ownership assertion fails after activation
    And the fixture closes its process and removes its private state


  Scenario: Hidden Clock comparisons keep declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the Clock replacement fixture prepares its comparison document
    Then its renderer viewport is 1920 by 1280 at unit scale before measurement
    And Linux uses isolated software rendering
    And the existing geometry, time, and font assertions remain required

  Scenario: Hidden Clock comparisons receive rendering frames
    Given the comparison window stays hidden on a supported host
    When the fixture waits for two rendering frames
    Then offscreen rendering supplies frames without showing the window
    And the existing comparison count and deadlines remain required

  Scenario: Production Clock rejects watchdog termination as guard evidence
    Given a missing Renderer control or Tick subscription reports its expected error
    When the child exits with code one and no signal
    Then the negative guard can accept the rejection
    When a watchdog terminates the child after that message
    Then the negative guard refuses that result
