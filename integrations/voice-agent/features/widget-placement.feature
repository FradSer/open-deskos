Feature: Voice chooses desktop widget locations
  Scenario: Discover and install at an exact location
    Given the Shell exposes numbered pages and occupied grid spans
    When the agent lists desktop locations and installs a draft with placement
    Then the lifecycle socket receives the exact page column and row span
    And the system verifier remains authoritative

  Scenario: Move a widget without modifying its package
    Given an installed widget
    When the agent calls the place tool with a new location
    Then only its catalog placement changes
    And occupied locations are reported as errors without automatic retry
