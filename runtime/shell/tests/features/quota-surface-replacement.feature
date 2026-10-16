Feature: Replace Quota surface while preserving readings and recovery

  Scenario: Quota remount consumes the selected shared subscription service
    Given a default, independent, or restored Quota page in the actual Shell
    When the shared subscription service changes and the page remounts
    Then the page reads and refreshes through the selected service
    And default provider updates cannot replace the selected reading
    And restoration remounts current default readings and releases selected subscriptions
    And a consumer that bypasses service selection fails acceptance

  Scenario: Independent rendering retains quota meaning and provenance
    Given mixed providers with healthy, exhausted, low, unknown, and failed accounts
    When default and independent Quota surfaces consume the same readings
    Then percentages, meters, labels, reset times, credits, and account states agree
    And unknown readings have no numeric meter
    And provider values remain inert text

  Scenario: Refresh preserves content and interaction state
    Given Quota has displayed accounts and an expanded focused account disclosure
    When a refresh waits, rejects, or produces updated accounts
    Then prior readings remain visible while waiting or rejected
    And busy state and recovery wording match the default implementation
    And updated accounts preserve disclosure state and focus by account identity
    And browser keyboard input activates the actual page refresh control

  Scenario: Replacement and cleanup preserve actual consumers
    Given a private Shell uses actual preload and development or signed Quota surface entries
    When the selected surface is replaced, disabled, enabled, and restored
    Then the actual page and comparison consumers execute the selected implementation
    And failed subscription release retains ownership until retry succeeds
    And released surfaces ignore late readings and refresh completion
    And the document and independent peers remain available

  Scenario: Production startup and management preserve joint Quota consumers
    Given actual Main selects an independent signed Quota source and page
    When actual preload and the subscription service publish all five provider states
    Then page readings and recovery messages match default startup
    And authenticated default restoration and activation retain those consumers in the same document
    And source ports, saved selections, and subscription ownership remain unchanged
    And an incorrect page reading fails the shared comparison
    And a missing page implementation fails the packaged mount guard

  Scenario: Hidden Quota comparisons retain each declared viewport
    Given a hidden host window has different native bounds or display scaling
    When the fixture selects either comparison viewport
    Then renderer metrics match that viewport at unit scale before measurement
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And existing interaction, lifecycle, geometry, and deadline assertions remain required
