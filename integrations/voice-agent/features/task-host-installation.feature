Feature: Managed Pi host installation
  Scenario: A configured Linux host owns tasks independently of voice recording
    Given a non-root account with Pi credentials and an explicit task configuration
    When the managed task user service starts
    Then it launches the task daemon independently of the voice service
    And private task data uses restrictive permissions
    And active runtime releases remain read-only

  Scenario: The Linux installer stages the task service on the stable path
    Given a CM5 whose active release is reached through the stable runtime symlink
    When the installer completes
    Then the task service unit points at the stable integration directory and not at a dated release
    And it is enabled only once the host has a task configuration
    And it stays staged and stopped without one

  Scenario: The task daemon runs through the stable installation path
    Given an installed integration reached through a stable release symlink
    When the task service starts the daemon through that symlink
    Then the daemon serves its control socket instead of exiting successfully without one
    And importing the module without running it starts no daemon

  Scenario: A configured Mac host owns tasks independently of SSH requests
    Given a logged-in Mac account with Pi credentials and an explicit task configuration
    When its launch agent starts
    Then it launches the same task daemon independently of SSH client lifetime
    And task configuration and executable locations are explicit operator substitutions
