Feature: Immutable runtime release deployment
  Device preflight must validate a staged candidate exactly as the kiosk
  session will run it, without depending on ambient installer environment.

  Scenario: Preflight uses integrations inside its own artifact
    Given a checkout or a sealed CM5 release with integration sources
    When runtime contract tests load an integration module or publisher
    Then they resolve that integration inside the same artifact
    And they do not depend on an ambient checkout outside the release

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

  Scenario: A candidate carries the required Personal Bot and Hosted Pi components
    Given a candidate whose release contains the voice integration, its service units, and its installed production dependencies
    When composition validation runs
    Then the candidate passes with both required components present

  Scenario: Shared reading typography does not declare a plugin
    Given a candidate contains the current built-in renderer plugins
    And the shared reading typography script loads before its consumers
    When composition validation runs
    Then all plugin entry modules declare manifest schema version 1
    And the shared typography helper lives in the WeRead support directory
    And the candidate passes without exempting any plugin from validation

  Scenario: A candidate missing a required component is rejected
    Given a candidate without the voice integration
    When composition validation runs
    Then it rejects the candidate naming voice as the missing required component
    And the active release is unchanged

  Scenario: A candidate missing Hosted Pi control is rejected
    Given a candidate carrying the voice integration but no Hosted Pi control service
    When composition validation runs
    Then it rejects the candidate naming Hosted Pi control as the missing required component

  Scenario: Required voice dependencies must live inside the candidate
    Given a candidate whose voice dependencies resolve outside the release
    When composition validation runs
    Then it rejects the candidate instead of accepting external dependencies

  Scenario: Device preflight uses the kiosk graphical session
    Given a staged candidate release
    And a kiosk user with an active graphical session
    When the updater runs release preflight
    Then the Electron verifier inherits the session display
    And Electron tests connect to the kiosk user's D-Bus session
    And activation never depends on ambient SSH environment variables

  Scenario: Staged candidate carries its repository-local workflow sources
    Given a staged candidate release
    When the installer seals the candidate
    Then the candidate contains the staged peripherals, integrations, experiments, and agent skills trees
    And the candidate contains Android main sources for its boundary checks
    And device preflight resolves repository sources from inside the candidate
    And release commands use the candidate as ODK_RUNTIME_ROOT
    And preflight never reads ambient copies outside the candidate

  Scenario: Complete preflight has a separate aggregate command budget
    Given the complete reference CM5 test command previously passed in 3051 seconds
    When the updater runs all preflight checks before activation
    Then the aggregate command has a 3600-second limit
    And post-activation verification keeps its 60-second limit and single attempt
    And individual test and smoke deadlines remain unchanged

  Scenario: A stalled verifier cannot retain the update lock
    Given a candidate verifier and its child ignore SIGTERM
    When the command deadline expires
    Then the updater kills only the verifier process group
    And verification fails without a retry
    And the previous release is restored and the update lock is released

  Scenario: A late window load cannot replace a smoke timeout
    Given the smoke window has exceeded its 15-second load deadline
    When its load event arrives before Electron exits
    Then smoke reports only the original failure

  Scenario: A portable test host lacks the CM5 command supervisor
    Given a test host without GNU coreutils timeout on PATH
    When release command tests run
    Then the real CM5 process regression declares the missing prerequisite
    And the remaining release contract tests still run

  Scenario: Sealed runtime code stays readable by the kiosk user
    Given installed dependency files have owner-only read permissions
    When the release becomes root-owned and immutable
    Then every runtime file is readable by the kiosk user
    And directories and existing executables retain traversal or execution permissions
    And no release file or directory stays writable

  Scenario: Private operator configuration never enters a release
    Given source directories contain private environment files and authentication state
    When the host stages or directly packages the release
    Then private inputs stay outside the artifact and original files stay unchanged
    And composition validation rejects any private input before sealing
    And newly created private inputs after preflight also prevent sealing
    And only root and the kiosk group can read sealed runtime code
