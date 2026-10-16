Feature: Personal Agent delegates general tasks to DeskOS child agents
  Scenario: Delegation takes precedence over the child's connector
    Given an installed MCP connector and a saved child identity
    And the previous turn created that identity
    When the owner asks that child to analyze a report through the connector
    Then the classification selects task delegation
    And the parent can admit the child without calling its connector directly
    And naming the saved identity does not request another identity change
    And uncertain classifications still require clarification

  Scenario: The host executes an admitted child without a second classification
    Given Jev classified the owner's request before the host admitted an isolated child
    When the child executes that exact assigned task
    Then the host selects the fixed direct-execution workflow without another Jev request
    And only the child's inherited permitted capabilities become active
    And task text cannot grant recursive delegation, identity, package or application mutations
    And cancellation prevents activation while each admitted turn receives fresh mutation reservations

  Scenario: A temporary child runs an independent task
    Given an explicit task request within configured capabilities
    When the Personal Agent starts a temporary child
    Then it returns an exact task handle before the task finishes
    And the child receives the task without the parent conversation
    And its conversation and memory have a separate private home
    And its finished response is distinct from verified completion
    And host admission selects fixed direct child execution
    And the child cannot delegate another child or change saved identities

  Scenario: A saved child retains its identity
    Given a saved identity with a role and a built-in avatar
    When the owner starts that identity again after restart
    Then it uses the saved role and the same identity-specific home
    And it does not share another identity's memory
    And only one task can use that identity at a time
    And status carries its saved avatar while it runs
    And an identity update reads its saved role and exact revision first

  Scenario: A saved child checks learned methods before reporting a missing procedure
    Given verified experience from an earlier task contains a relevant report procedure
    When a later report omits that procedure
    Then the child reads the relevant full experience before concluding that the procedure is unavailable
    And an absent or unsupported method still requires review

  Scenario: A cancelled child cannot report successful completion
    Given a child is starting or working
    When the owner cancels its exact task handle
    Then the child receives cancellation
    And late answers cannot become successful task results
    And the runtime does not replay the task

  Scenario: A restarted runtime preserves uncertainty
    Given a recorded task was running before the host stopped
    When the runtime opens its private records again
    Then the old task becomes interrupted
    And no child is started automatically
    And final verification remains incomplete

  Scenario: Task ownership and storage are bounded
    Given another runtime owns the task records or a private path is linked
    When a new runtime attempts to use that storage
    Then it refuses the operation
    And it preserves existing records
