Feature: E2E validates the current declarative desktop
  Scenario: Every declared widget is present once
    Given the current desktop layout declares its widget identities
    When E2E inspects the Home page
    Then the rendered widget identities exactly match the declaration
    And each widget retains readable content, truthful state and bounded geometry

  Scenario: Optional providers are explicit deterministic fixtures
    Given an Electron harness uses the production preload
    When the shell requests WeRead or user application state
    Then the harness returns an explicit unconfigured or empty state
    And unavailable provider states remain subject to layout validation
