Feature: Widget interface-quality references
  Scenario: Widget implementation incorporates its interface disciplines
    Given the Open DeskOS widget engineering skill
    When an agent starts, implements, or stress-tests a widget change
    Then the original upstream skill texts for accessibility, colors, layout, typography, UI, writing, break testing, interface explanation, and variants are inherited as flat widget reference documents
    And each implementation workflow phase references the relevant inherited entry text without an upstream skill directory
    And every linked upstream sub-reference is flattened alongside its entry document
    And the implementation workflow directs those references through required verification before deployment
    And it does not use change review or interface review as an implementation-phase or deployment gate

  Scenario: A completed widget change receives a separate interface review
    Given a widget implementation and its required verification are complete
    When an agent runs the post-creation interface review
    Then it reads the change-scoped interface-review reference
    And it consolidates the findings through the better-interface reference
    And it classifies introduced regressions separately from pre-existing findings
    And it runs after required verification without blocking deployment
