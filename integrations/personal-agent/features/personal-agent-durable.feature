Feature: Personal Agent uses Pi Durable 1.2
  Scenario: Production construction uses the Durable Harness
    Given either resident profile and an operator-configured model
    When a user request enters the default Personal Agent runtime
    Then Pi Durable executes the model and reviewed capability calls
    And public response snapshots contain only assistant text committed by Durable
    And the transcript persists separately from legacy Coding Agent sessions

  Scenario: First Durable startup retains the legacy conversation context
    Given an existing Coding Agent conversation and an empty Durable conversation
    When the resident starts with Pi Durable
    Then it imports the canonical legacy model context once
    And it retains compaction summaries without restoring old system instructions or tool authority
    And unresolved historical tool calls have an error result and never execute
    And it leaves the legacy files unchanged
    And an existing Durable conversation takes precedence over legacy context

  Scenario: Proactive generation runs independently of owner conversation history
    Given owner goals and current timestamped observations
    When the monitor requests advice or a home briefing without an owner message
    Then an isolated Durable conversation generates the response
    And that conversation has no tools, Skills, memory or execution environment
    And closing the generator releases its Harness

  Scenario: An old run cannot borrow a new owner's intent
    Given an unfinished run from a previous process
    When a new owner request selects a capability
    Then tool admission checks the active run's persisted request identity
    And calls belonging to the old run cannot use the new request's intent or confirmation

  Scenario: Private storage refuses linked transcript files
    Given a storage file linked to a file outside the private directory
    When the runtime opens that directory
    Then it refuses the linked file before private reads or writes
    And the external file remains unchanged

  Scenario: One process owns each durable storage directory
    Given a runtime that owns a durable storage directory
    When another process opens the same directory
    Then the second writer is refused
    And closing the first runtime releases its ownership

  Scenario: A resident conversation survives a host process restart
    Given a private durable state directory and a configured model
    When the runtime closes and opens the same directory
    Then the conversation keeps its identity and committed transcript
    And repeating a request ID does not create another submission

  Scenario: Reviewed capabilities execute through Durable Code Mode
    Given an explicitly registered capability with a structured result
    When Code Mode calls the capability through the Durable tool pipeline
    Then argument validation and the existing capability guard run
    And the script receives the declared structured result
    And auxiliary model tools remain unavailable

  Scenario: An interrupted mutation is not replayed
    Given a side-effecting capability with an uncommitted result
    When the runtime closes during execution and opens its storage again
    Then Durable reports an interrupted result
    And the capability does not repeat its side effect

  Scenario: Local execution uses the Pi environment implementation
    Given an explicit local project and an owned Pi environment connection
    When an environment-backed tool reads a file
    Then it returns the file from that project
    And closing the runtime closes its owned connection

  Scenario: Coordinator file search uses the Pi environment file inventory
    Given an explicit local project with ignored and nested files
    When the coordinator searches for files through Code Mode
    Then Pi env supplies the file inventory through its daemon
    And the search preserves basename and full-path glob behavior
    And an incomplete inventory cannot certify that a file is absent

  Scenario: Remote execution retains host ownership
    Given an explicitly configured remote connection and project
    When the host constructs an execution environment
    Then Pi env supplies the remote file and process operations
    And conversation storage and provider credentials remain on the Shell Host
    And construction does not accept host keys or install a remote service

  Scenario: Remote execution uses authenticated SSH without accepting host keys
    Given a loopback SSH fixture with generated client and host keys
    And its SSH configuration requests forwarding of a client-only environment value
    When Durable reads through an explicitly connected RemoteExecutionEnv
    Then the real SSH transport returns the selected target's file and process results
    And provider-only environment values and conversation storage stay on the client
    And unknown or changed host keys refuse the connection before daemon execution

  Scenario: Recovery does not restore transient authorization
    Given a coordinator capability admitted during an owner turn
    When the host restarts without that turn's intent and confirmation
    Then an unfinished model run cannot authorize another action
    And existing capability guards refuse the action
