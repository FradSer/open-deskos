Feature: Run operator-selected services in Docker
  Scenario: Require an immutable image for the selected platform
    Given a service manifest selects an image digest or local content ID
    When the operator prepares the service revision
    Then the backend checks the image platform
    And a missing digest can be pulled without accepting mutable image tags

  Scenario: Start a restricted container without exposing secret values
    Given explicit operator environment and mount paths
    When the service starts
    Then the container uses a non-root user and a read-only root filesystem
    And the container has bounded resources and no added Linux capabilities
    And the command refers to the environment file instead of its secret values

  Scenario: Preserve unrelated containers during lifecycle operations
    Given a container does not have the exact runtime, service, and revision ownership labels
    When the backend receives a stop or remove request
    Then no container mutation occurs
    And the backend reports the ownership failure

  Scenario: Preserve uncertain cleanup for operator recovery
    Given an owned container cannot be inspected or removed
    When cleanup is requested
    Then cleanup reports failure and retains the container handle

  Scenario: Mount a private user runtime socket directory
    Given an operator-owned runtime subdirectory has mode 0700
    When the service mounts that subdirectory for its Unix socket
    Then the private directory can be writable
    And broad runtime directories and Docker socket parents are refused
    And regular file mounts must be read-only

  Scenario: Reject a handle from another runtime root
    Given the backend has an explicit runtime root
    When a handle belongs to another root
    Then stop and removal fail before any Docker mutation

  Scenario: Recover interrupted container creation
    Given startup reserves and saves a container name before creation
    When creation succeeds but the caller loses its result
    Then cleanup finds the exact owned container by its reserved name
    And cleanup accepts a confirmed absent container after a lost removal result
    And daemon failures retain the recovery handle

  Scenario: Refuse environment overrides of the service runtime
    Given an environment file contains a Python or host loader override
    When startup validates the operator configuration
    Then creation fails without exposing the environment value
    And an explicit container HOME remains permitted

  Scenario: Retain a reservation while daemon creation can still complete
    Given Docker creation times out before a container becomes visible
    When an immediate inspection reports no container
    Then cleanup retains the pending reservation
    When the exact owned container becomes visible
    Then cleanup can remove the container
    And a later confirmed absence can complete removal recovery
