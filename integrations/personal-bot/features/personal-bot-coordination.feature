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

  Scenario: Previously reported legacy revisions are not presentation migrations
    Given retained legacy messages and exact seen revisions
    When completion subscriptions reconnect after an upgrade
    Then those revisions do not call a model or rewrite retained history
    And only a new explicit terminal identity can produce another update

  Scenario: Remote assistants speak only for completed turns with a conclusion
    Given connected reported sessions and configured Hosted Pi tasks
    When a read-only completion event arrives or a subscription reconnects
    Then the resident reads a bounded completion inventory without a periodic progress timer
    And active turns, missing conclusions, and unavailable sources cause no summary model call
    And a completed failed or cancelled turn retains its actual outcome
    And repeated metadata changes for the same completed turn do not repeat a message
    And busy turns retain one pending refresh and paginated completions drain without another event
    And restart retains old history, seen watermarks, and held revisions

  Scenario: Task admission stays understandable without losing exact control references
    Given a durable launch, queued prompt, or unknown mutation outcome
    When the coordinator replies to the owner
    Then it uses the natural task name and distinguishes admission from completed execution
    And exact control references remain internal unless the owner explicitly requests them

  Scenario: Restart catchup preserves a completed turn but not interrupted work
    Given a Hosted Pi reload with a retained lastTurnId and no active turn
    When its explicit outcome is finished, failed, or cancelled
    Then an unreported completion can enter the conversation once
    But an interrupted in-flight outcome cannot become a completion message

  Scenario: Configured completion identities migrate without replaying old conclusions
    Given legacy configured history or held revisions without completion identities
    When the reader first supplies a real terminal turn identity after an upgrade
    Then an exact legacy projection or retained task revision maps silently to that identity
    And ambiguous legacy history establishes only a conservative current baseline
    And old messages, seen revisions, and held revisions remain unchanged
    And restart does not summarize that baseline but a later distinct completed turn can notify
    And a new source without legacy history can notify its first completion
    And a live observed running turn remains reportable when that same UUID completes after restart
    But unknown, unavailable, and invalid active identities cannot establish that evidence

  Scenario: Reported completion identities migrate without replaying legacy conclusions
    Given legacy seen or held reports without their real assistant event identity
    And a different older reference can already have a real event identity
    When the reporter supplies the current persisted terminal assistant event identity
    Then the unknown legacy version establishes only a silent migration baseline
    And only an exact watermark revision reference can restore a previously known identity
    And old messages, seen revisions, and held records remain unchanged
    And restart and metadata changes do not generate that baseline again
    But a later distinct terminal event and a source without legacy history can notify
    And progress, unknown outcomes, and unavailable records cannot establish completion evidence
    And an older unidentified held record cannot absorb a new completion after the latest watermark has a real identity

  Scenario: Completed Pi turns preserve conditional criteria and planned work
    Given a completed Pi turn describes a condition, acceptance criterion, or plan
    When the Personal Agent generates and reviews its assistant update
    Then both providers retain the source tense and conditional scope
    And a settled or reported_finished turn does not prove that the criterion was fulfilled
    And an update that upgrades a condition into completed work requires review

  Scenario: Inventory reads retain replies written while a page is pending
    Given a remote inventory page is waiting for its source
    When an owner reply is saved or completed before the page returns
    Then migration uses the latest checkpoint without losing the reply or its receipt
    And an unknown delivery and its answer remain unchanged after restart

  Scenario: Reply persistence failures cannot crash an owner turn
    Given a typed or voice owner turn has a bound reply
    When both final reply persistence and failure persistence throw
    Then the turn resolves to a safe error without an unhandled rejection
    And recording cleanup and existing turn finalization still run

  Scenario: Receipt persistence failure preserves uncertain delivery
    Given a reply crossed its send boundary and receipt persistence failed
    When the owner service saves its failure state after storage recovers
    Then the reply remains unknown rather than failed
    And no delivery acceptance is invented or earlier instruction replayed

  Scenario: The host acknowledges only the current reply receipt
    Given routing selects session continuation for a typed or voice owner turn
    When the selected workflow returns with or without a bound reply receipt
    Then its model draft text is not shown during that continuation
    And the host saves and displays the same short receipt-based acknowledgement
    And unknown delivery does not become confirmed arrival or completed work
    And a reply that never crossed its send boundary is reported as not sent
    And a failed reply with an uncertain receipt keeps its unknown delivery
    And a continuation without a bound receipt cannot display a model delivery claim in either profile
    And ordinary answers and clarification selected before continuation retain their existing behavior
