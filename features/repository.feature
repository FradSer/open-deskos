Feature: Explicit repository project governance
  Scenario: Inspect independently installed projects without changing the checkout
    Given an explicit project inventory with unique IDs and reviewed owner scopes
    When the operator lists or checks the repository
    Then each active Node package has its own declared name and lockfile
    And research firmware is outside the active package inventory
    And no install, network, build, or device command runs

  Scenario: Keep the recommendation subsystem behind its public entry
    Given recommendations have reviewed peer dependencies and one public index
    When a consumer imports an internal file or the subsystem imports an unreviewed peer
    Then the repository check fails with the source and dependency
    And renderer imports of backend code also fail

  Scenario: Surface missing registration and command failures
    Given an active Node package is not registered or a command exits unsuccessfully
    When the repository check or explicit project command runs
    Then the command returns a nonzero status
    And unsupported manual commands never report a successful execution

  Scenario: Select affected projects and their consumers
    Given a Git reference and declared project dependencies
    When changed files belong to a project or subsystem
    Then affected lists that project and its transitive consumers
    And repository governance changes select every project
