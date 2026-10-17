Feature: A resident Personal Bot coordinates work without implementing it
  Scenario: Resuming the coordinator does not restore generic mutation tools
    Given a resident coding conversation with earlier implementation history
    When the Pi session is created or resumed
    Then read, grep, find and ls are available for inspection
    And write, edit, bash and other generic shell tools are unavailable
    And reviewed desk and Hosted Pi capabilities remain available

  Scenario: A coding handoff frees the next Spoken Turn
    Given a configured target accepting a long Hosted Pi coding turn
    When the Personal Bot coordinator receives its durable launch receipt and reports acceptance
    Then voice returns to idle while the Hosted Pi remains working
    And the next MIC action starts a new recording
    And neither dismissal nor the next recording cancels that Hosted Pi

  Scenario: No target means no fallback implementation
    Given no configured coding target
    When the coordinator receives a source implementation request
    Then it reports the required target configuration
    And it has no generic mutation tools to implement the request locally

  Scenario: Worker capability is unchanged
    Given an admitted Hosted Pi started by voice or by a Console
    When its session is created
    Then the host's full coding tool set is available
    And there is no voice-origin edit-and-test-only profile

  Scenario: Connected Pi conclusions enter the existing owner conversation
    Given several reporting machines and separately configured control targets
    When their latest assistant conclusions change or reconnect
    Then a bounded paginated inventory retains each machine and session identity
    And the agent synthesizes cited conclusions with zero tools
    And this conversation retains the summaries and exact source references after restart
    And omitted, stale, unavailable, and unverified outcomes stay explicit
    And reporting credentials never grant task control

  Scenario: Owner follow-up continues the exact remote task
    Given a previously summarized configured task and its current revision
    When the owner asks to change that task
    Then Jev routes the owner request before any mutation
    And the original target, project, task, and expected turn remain bound
    And an unknown delivery outcome is reconciled without replay
    And remote output cannot create an owner request or select an endpoint

Scenario: The resident Linux coordinator reaches the canonical local task daemon
  Given the Bot and task daemon use the same canonical task configuration
  And no operator EnvironmentFile overrides that configuration
  When the resident calls its configured local task helper
  Then the real task CLI reaches the daemon with the inherited absolute configuration
  And a missing configuration does not appear as an empty task inventory
