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
    Then accessibility, colors, layout, typography, UI, writing, stress testing, interface explanation, and variants are covered by consolidated domain guides
    And each implementation workflow phase references the relevant domain guide without an upstream skill directory
    And every linked local reference resolves within the skill reference tree
    And the implementation workflow ends at deterministic runtime verification
    And it does not use change review or interface review as an implementation gate

  Scenario: A completed Widget or App change receives a separate interface review
    Given a Widget or App implementation and its required verification are complete
    When an agent runs the post-creation interface review
    Then it reads the consolidated review reference for change scope
    And it consolidates the findings through the same review reference for severity and reporting
    And it classifies introduced regressions separately from pre-existing findings
    And it reports quality without performing Git or deployment operations

  Scenario: Creation preserves the accepted composition and optional headings
    Given a shared Shell Widget request with retained layout constraints
    When the agent records the creation contract
    Then it preserves source authority, App identity, lifecycle, spans, and page order
    And it decides title and icon use for each surface
    And omitted headings leave no empty header while accessible App names remain
    And useful headings stay at the shared inset above independently centered readings

  Scenario: Verification separates shared rendering from host acceptance
    Given a Widget supports four inherited themes on Linux, Windows, and macOS
    When the agent verifies the final candidate
    Then it uses affected checks before applicable shared delivery gates
    And native captures require current-frame acknowledgement and actual pixels
    And fixture, host, live-source, and physical-input evidence remain distinct
    And a focused rerun cannot clear a failed complete gate
