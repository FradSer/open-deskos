Feature: Delegate isolated desktop work
  Scenario: Submit and observe an independent desktop task
    Given the operator configured a private desktop agent socket
    When the owner delegates an anonymous Chrome task with a stable request ID
    Then the coordinator receives admission without screenshots or input controls
    And a later result separates lifecycle from outcome verification
  Scenario: Unknown submission outcome
    Given the service accepted a task but the response connection was lost
    When the coordinator receives the transport failure
    Then it reports an unknown outcome without automatic retry
  Scenario: Private intervention
    Given a desktop task waits for login or human verification
    When the model tries to submit a secret or human confirmation
    Then the tool rejects the arguments before dispatch
    And only the separate operator interface can resolve private intervention
  Scenario: Child capability boundary
    Given desktop delegation is configured
    When a generic child starts
    Then it does not inherit desktop task controls

  Scenario: The synthetic delegation harness uses the native Pi model interface
    Given the delegation acceptance uses deterministic coordinator decisions
    When the native Pi Durable harness attaches its model identity
    Then the supplied model interface supports the native authentication contract
    And no provider credential, paid inference, screenshot, or input control reaches the coordinator
