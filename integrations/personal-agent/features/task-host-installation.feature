Feature: Managed Pi host installation
  Scenario: A configured Linux host owns tasks independently of voice recording
    Given a non-root account with Pi credentials and an explicit task configuration
    When the managed task user service starts
    Then it launches the task daemon independently of the Personal Agent service
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

  Scenario: Task host resources use the common plugin lifecycle
    Given the task listener, service, and endpoint publisher plugins
    When the host starts
    Then the listener starts before service initialization
    And the endpoint publishes only after service initialization
    When the host stops
    Then the endpoint is withdrawn before the listener closes
    And the listener closes before the task service
    And each resource closes once
    And cleanup failure cannot skip remaining resources

  Scenario: Endpoint publication failure preserves task control
    Given a running listener and task service
    When endpoint publication fails
    Then task requests remain available
    And the existing publication warning is reported

  Scenario: Stop cancels pending task initialization
    Given task service initialization is pending
    When the host stops
    Then the late service closes without publishing an endpoint
    And the CLI accepts shutdown signals before plugin startup
    And constructing a daemon does not start its resources

  Scenario: Selected task service retains cancelled tasks across disable and enable
    Given the default or selected service runs a task with the existing task engine
    When the service plugin is disabled
    Then the active task is cancelled and its record is saved
    And the listener remains available without a task service
    When the service plugin is enabled again
    Then status reads the saved cancelled task without executing it again
    And endpoint publication follows service availability
