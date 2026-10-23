Feature: Pi v1.2 codemode is the voice orchestration entry point
  Scenario: Proposal execution checks available tools without inference
    Given the resident has a reviewed action tool and configured targets
    When a card checks its action availability
    Then the resident validates the actual tool schema and target
    And discovery does not call a tool, classifier, or model
    And installation without a fixed destination has no executable card action

  Scenario: Proposal receipts distinguish admission from completion
    Given the owner confirms an available proposal action
    When the existing tool returns its result
    Then only a verified completed operation returns a completed receipt
    And task admission returns its identity without claiming task completion
    And tool errors and uncertain receipts cannot establish completion

  Scenario: A delayed classifier cannot revive an invalid proposal action
    Given a confirmed action is waiting for its selected intent
    When its lifetime, source binding, or execution context expires
    Then the resident refuses execution before calling the tool
    And private memory remains unchanged

  Scenario: Unknown task transport retains the original mutation identity
    Given a task start reaches its configured helper
    When the helper closes without a correlated receipt
    Then the proposal retains the original task and mutation identities
    And an error message cannot forge those transport-owned identities
    And the resident does not retry the mutation

  Scenario: One model tool orchestrates a fixed reviewed surface
    Given a coding coordinator with readonly inspection and reviewed system capabilities
    When a Spoken Turn invokes codemode
    Then only codemode is declared to the model
    And scripts can call the reviewed capabilities and readonly inspection tools
    But scripts cannot reach generic write, edit, bash, powershell or classifier credentials
    And extensions and MCP servers are not discovered from user or project configuration

  Scenario: Loading resources does not discard the coordinator tool selection
    Given either resident profile configured by the operator agent directory
    When the production startup reloads resources and creates its SDK session
    Then codemode remains the only model-facing tool
    And reviewed capabilities remain callable through it
    And session startup does not persist a cache-warming override to operator settings

  Scenario: Unknown tool probes use membership without aborting a useful script
    Given Pi v1.2 guards unknown tool members with actionable errors
    When the coordinator checks an optional or excluded tool before calling it
    Then it uses membership or tool discovery rather than typeof property access
    And unavailable tools remain absent from the callable registry
    And a mistaken tool name reports a recoverable error without replaying completed calls

  Scenario: Personal codemode retains exact-turn authorization
    Given the personal profile with memory and reviewed Skills
    When a script attempts a memory change without this turn's exact user command
    Then the memory store refuses it through the normal nested tool pipeline
    And no generic filesystem or shell tool is callable
    And the existing DiDi next-turn confirmation gate still applies

  Scenario: Independent read failure does not abort sibling results
    Given two independent readings where one provider refuses its request
    When a script awaits allSettled and reports each outcome
    Then the successful reading survives and the other reading reports failure
    And dependency-ordered or mutating operations are not described as independent reads

  Scenario: Script failure does not replay mutations or promote partial store state
    Given a script that completed a mutation before another call failed
    When codemode reports the script failure
    Then its completed side effects are not undone or automatically retried
    And only successful-script store writes persist as non-authoritative data
    And the coordinator reports uncertain outcomes with durable identities

  Scenario: Nested command evidence is retained outside script output
    Given a Hosted Pi running coding_check inside codemode
    When the script omits the check result from its output or fails afterwards
    Then the host persists the observed check metadata in its existing session log
    And history can read it by physical position after restart without replay
    And a nested process outcome is not an assistant response or independent verification

  Scenario: Public speech feedback excludes nested tool records
    Given a codemode script emitting internal output and nested tool events
    When the agent publishes a streaming response
    Then only top-level visible assistant text reaches voice feedback
    And tool results, nested replies and internal thinking never become spoken answers
