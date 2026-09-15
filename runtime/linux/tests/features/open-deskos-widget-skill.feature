Feature: Widget interface-quality references
  Scenario: Every upstream interface discipline is available to the widget workflow
    Given the Open DeskOS widget engineering skill
    When an agent starts, implements, stress-tests, or reviews a widget change
    Then the original upstream skill texts for accessibility, colors, interface review, layout, typography, UI, writing, break testing, interface explanation, change review, and variants are inherited as flat widget reference documents
    And each workflow phase references the relevant inherited entry text without an upstream skill directory
    And every linked upstream sub-reference is flattened alongside its entry document
    And the widget workflow directs the agent through those references before release verification
