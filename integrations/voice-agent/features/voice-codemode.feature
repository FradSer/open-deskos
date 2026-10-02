Feature: Pi v1.0 codemode is the voice orchestration entry point
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
    Given Pi v1.0 guards unknown tool members with actionable errors
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
