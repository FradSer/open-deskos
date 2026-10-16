Feature: Reviewed resident capabilities
  Operator declarations select fixed DeskOS capabilities.
  Skills provide instructions and do not grant capabilities.

  Scenario: Normalize existing operator configuration
    Given a personal profile with a legacy DiDi declaration
    When the host validates the configuration
    Then it produces the same canonical capability declaration
    And conflicting declarations fail before a capability starts

  Scenario: Reject unsupported capabilities
    Given a coding profile or an unknown capability identifier
    When the host validates the declaration
    Then startup fails without loading external modules

  Scenario: Delegate only isolated capabilities
    Given declared browser and DiDi capabilities
    When the host creates an isolated child
    Then only the browser declaration is inherited
    And its session belongs to the child's private state directory

  Scenario: Keep reviewed workflow gates
    Given a reviewed capability tool
    When a different intent requests that tool
    Then the capability remains unavailable
    And generic extension routing cannot bypass the workflow gate

  Scenario: Preserve uncertain cleanup across repeated disposal
    Given a reviewed capability cannot confirm resource cleanup
    When concurrent callers close the reviewed runtime
    Then every caller observes the same cleanup failure
    And a later close cannot report a confirmed release
