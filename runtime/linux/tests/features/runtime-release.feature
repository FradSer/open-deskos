Feature: Immutable runtime release deployment
  Device preflight must validate a staged candidate exactly as the kiosk
  session will run it, without depending on ambient installer environment.

  Scenario: Candidate production dependencies load before activation
    Given a release with pnpm-linked production dependencies
    When a required transitive package is missing from the candidate
    Then release dependency validation under the candidate Electron browser process fails with the missing module diagnostic
    And validation runs before graphical smoke and activation
    And a complete dependency tree passes without contacting external services

  Scenario: Ambient dependencies cannot satisfy a candidate
    Given a candidate missing its production package
    And that package is available outside the candidate
    When release dependency validation runs
    Then it rejects the external package instead of accepting an incomplete release

  Scenario Outline: External transitive dependencies cannot satisfy a candidate
    Given a candidate with its direct production package inside the release
    And a required transitive package is available only through <source>
    When release dependency validation loads the production dependency tree
    Then both Node and the candidate Electron browser process reject the release
    And a loaded external transitive module is reported by its real path
    And a runtime that ignores NODE_PATH reports the missing module instead

    Examples:
      | source                         |
      | an ambient NODE_PATH directory |
      | an external pnpm symlink       |

  Scenario: Renderer dependencies are sealed inside the candidate
    Given a candidate whose renderer loads a local Markdown browser bundle
    When that script is missing or resolves outside the candidate
    Then composition validation rejects the candidate
    And an installed browser bundle inside the candidate passes

  Scenario: Device preflight uses the kiosk graphical session
    Given a staged candidate release
    And a kiosk user with an active graphical session
    When the updater runs release preflight
    Then the Electron verifier inherits the session display
    And activation never depends on ambient SSH environment variables

  Scenario: Staged candidate carries its repository-local workflow sources
    Given a staged candidate release
    When the installer seals the candidate
    Then the candidate contains the staged peripherals, integrations, experiments, and agent skills trees
    And device preflight resolves repository sources from inside the candidate
    And preflight never reads ambient copies outside the candidate
