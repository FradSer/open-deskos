Feature: Independent external service revisions
  Scenario: Prepare and select a trusted revision
    Given an operator-selected package with exact file hashes and private bindings
    When its isolated execution environment is prepared successfully
    Then the runtime selects its content-addressed revision without starting it
    And package files cannot contain links, traversal, or undeclared inputs

  Scenario: Preserve the active revision after an unsuccessful update
    Given an enabled service and a new prepared revision
    When the new revision cannot pass its readiness probe
    Then the runtime stops its owned candidate before restoring the previous revision
    And the failed update does not replace the selected revision
    And uncertain cleanup blocks another activation

  Scenario: Disable, restore, and remove a service
    Given an enabled service with retained revisions and private credentials
    When the operator disables, rolls back, or removes it
    Then only its owned runtime resources are changed
    And removal preserves external configuration, credentials, and retained revision snapshots

  Scenario: Forward process termination to owned Python work
    Given a foreground service runner owns a Python process group
    When the runner receives SIGTERM
    Then the child receives termination and can release its resources
    And the runner bounds shutdown without signaling a saved process identifier
    And a signal during an existing wait grants the complete shutdown deadline

  Scenario: Keep inspection free of provider activity
    Given installed service metadata
    When the operator lists or inspects it
    Then no dependency installation or service startup occurs
    And private environment values and provider output are excluded

  Scenario: Recover an interrupted activation
    Given the runtime saves an owned resource reservation before creating a service
    When activation terminates before the backend returns
    Then a new runtime can disable the reserved resource
    And unknown cleanup remains pending until absence is confirmed

  Scenario: Stop a service with damaged retained inputs
    Given an enabled service has a valid owned runtime handle
    When a retained package input becomes damaged
    Then disable still releases the owned service
    And another start fails integrity validation

  Scenario: Reject blocking package inputs
    Given a descriptor or declared input is a FIFO or exceeds its read limit
    When the runtime captures the package
    Then it refuses the input without blocking or executing package code

  Scenario: Release foreground descendants and prevent duplicate runners
    Given a foreground runner owns its service lease and process group
    When its entry process exits or receives termination
    Then the runner terminates remaining group members within its shutdown deadline
    And a second runner cannot acquire the same service lease

  Scenario: All readiness attempts share the declared admission budget
    Given a selected Python or Docker revision declares one readiness timeout
    When failed probes retry or a probe completes after that deadline
    Then each operation receives only the remaining budget
    And completion at or after the deadline cannot commit a running selection
