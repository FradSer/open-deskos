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
    And a separate zero-tool reviewer checks report faithfulness, source ownership, and readable assistant updates
    And both phases require exactly one citation for each unique source key
    And a rejected duplicate citation receives the current exact citation count on its sole correction attempt
    And reporting a supplied number requires no invented computation receipt
    And execution, calculation, and delivery claims remain independently unverified
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
    And the parent describes task progress naturally instead of reciting internal identifiers
    And accepted or queued follow-up delivery is not completed execution

Scenario: The resident Linux coordinator reaches the canonical local task daemon
  Given the Bot and task daemon use the same canonical task configuration
  And no operator EnvironmentFile overrides that configuration
  When the resident calls its configured local task helper
  Then the real task CLI reaches the daemon with the inherited absolute configuration
  And a missing configuration does not appear as an empty task inventory

Scenario: Native acceptance uses the configured endpoint directory
  Given a private existing native endpoint directory configured on the host
  When the operator plans an isolated native fixture
  Then the fixture uses its explicit endpoint override or the inherited host endpoint
  And it validates the real directory owner and private mode without changing other descriptors

  Scenario: Remote work becomes short assistant updates with exact source ownership
    Given several remote tasks have new conclusions or an evidence gap
    When the parent summarizes those reports without tools
    Then it returns one to seven short updates instead of an audit report
    And each update covers one topic and owns its exact source keys
    And those keys partition every supplied source exactly once
    And every source still has one exact citation
    And each update has at most 600 UTF-16 code units within a 2000-unit batch
    And a separate model checks faithfulness, source attribution, and readability
    And generic reported-or-unverified notices stay in Sources rather than message bodies
    And material task-specific evidence gaps remain explicit
    And unsupported actions, verification claims, or swapped source assignments remain held
    And one transaction appends the ordered messages with stable IDs and the assistant_update presentation
    And restart and history pagination preserve their order and exact references without another model call
    And old messages and held revisions keep their original data and behavior

  Scenario: A successful legacy report receives one assistant presentation upgrade
    Given a fresh source revision was already summarized before assistant updates existed
    And no assistant update references that exact revision
    When the source is read again
    Then one read-only synthesis can append its new assistant presentation
    And old messages and source references remain unchanged
    And an attempted or held revision cannot be retried for presentation
    And a failed upgrade remains durably held without another model call
    And a successful upgrade survives restart without another synthesis
    And its presentation watermark survives disconnected history expiry
