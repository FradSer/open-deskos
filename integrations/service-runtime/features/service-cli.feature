Feature: Operators manage services through one command entry
  Scenario: A trusted installation uses operator configuration
    Given an absolute package path and a private configuration file
    When the operator installs that package with explicit trust
    Then the service manager receives the package and configuration separately
    And public output excludes credential bindings and runtime handles

  Scenario: Updates require an existing service
    Given a valid package whose service is not installed
    When the operator requests an update
    Then the command refuses installation

  Scenario: The unified plugin command delegates service work
    Given the service runtime launcher and an operator-selected Python executable
    When the operator invokes the plugin service command
    Then arguments reach the launcher without shell interpretation
    And it preserves the actual exit status
    And process failures disclose no credentials or private diagnostics

  Scenario: Terminate a foreground service through the unified CLI
    Given the unified CLI owns a foreground runner
    When the CLI receives SIGTERM or SIGINT
    Then it forwards termination to the owned runner
    And it waits for bounded runner cleanup before completion
