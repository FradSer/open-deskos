Feature: Open DeskOS Widget and App design-development skill
  Scenario: Skill checks run inside an immutable CM5 release
    Given a release containing release.json, tests, and its own .agents skill tree
    And no repository-level skill tree exists above the release
    When the release preflight runs the Widget and App skill tests
    Then all skill checks pass using only the packaged skill tree
  Scenario: The skill routes work to the correct product surface
    Given a request to design or develop an Open DeskOS Widget or App
    When the skill starts
    Then it distinguishes trusted built-in plugins from installable user applications
    And it distinguishes display-only Widgets from interactive Apps
    And it reads the authoritative runtime guide for the selected surface
    And built-in plugins use Shell semantic tokens while installable packages carry a self-contained palette
    And it does not include Git commit or CM5 deployment operations

  Scenario: Widget and App implementation incorporates interface disciplines
    Given the Open DeskOS Widget and App design-development skill
    When an agent designs, implements, or stress-tests a Widget or App change
    Then the original upstream skill texts for accessibility, colors, layout, typography, UI, writing, break testing, interface explanation, and variants are inherited as flat reference documents
    And each implementation workflow phase references the relevant inherited entry text without an upstream skill directory
    And every linked local reference resolves within the skill reference tree
    And the implementation workflow ends at deterministic runtime verification
    And it does not use change review or interface review as an implementation gate

  Scenario: A completed Widget or App change receives a separate interface review
    Given a Widget or App implementation and its required verification are complete
    When an agent runs the post-creation interface review
    Then it reads the change-scoped interface-review reference
    And it consolidates the findings through the better-interface reference
    And it classifies introduced regressions separately from pre-existing findings
    And it reports quality without performing Git or deployment operations
