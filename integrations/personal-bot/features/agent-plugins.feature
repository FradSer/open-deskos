Feature: Personal Agent owns a bounded plugin runtime
  Scenario: Evidence preserves literal tool text for exact citations
    Given a tool or computation returns text with quotes and backslashes
    When completion receives its bounded evidence receipt
    Then fixed labels separate raw text from canonical structured JSON
    And exact citations match the original text without decoding or fuzzy matching
    And successful computation still cannot prove an external action

  Scenario: Explicit owner notes enter current model context after restart
    Given the owner saved a note through the routed memory tool
    When the resident restarts and receives another owner request
    Then the actual Durable model request contains that private note as reference data
    And later updates and deletion change the next request's memory block
    And learned experience remains a separate store

  Scenario: Native Pi extensions cannot enter the Personal Agent
    Given an operator selects Personal Agent plugins
    When the resident constructs its runtime
    Then only built-in Open DeskOS plugin identities are accepted
    And no package name, JavaScript path, or Pi extension is loaded

  Scenario: Experience enters a later task as reference data
    Given a completed task produced a verified reusable lesson
    When a later task starts after a process restart
    Then the model receives a bounded index of learned experience
    And a read-only tool retrieves the complete selected entry
    And Code Mode receives declared structured search and read results
    And experience supplies neither current observations nor action authorization

  Scenario: Completion receives a separate verification pass
    Given the resident has produced an answer and host-observed tool receipts
    When its completion plugin checks the answer
    Then an isolated zero-tool model checks each requested outcome against cited receipts
    And tool orchestration does not add an unrequested derivation requirement
    And accepted or running work cannot become completed work
    And missing, failed, truncated, or invalid evidence requires review
    And verification never replays a mutation
    And a child start or continuation receipt proves only admission

  Scenario: Derived answers retain actual computation evidence
    Given a task supplies data and an applicable method
    When the actual Durable Code Mode executes a calculation
    Then completion receives bounded source and output from that execution
    And a derivation check must compare the input, method, execution, and answer
    And formatting or returning derived output remains part of derivation
    And printed claims cannot prove an external action or downstream completion
    And failed, truncated, cancelled, or stale computation cannot prove success
    And computation output cannot become an independent source for learned facts

  Scenario: Coding inspection produces completion evidence
    Given the coding profile reads or searches the configured checkout
    When the actual Durable inspection tools return
    Then completion receives their bounded host-observed results
    And failed, truncated, or omitted output cannot establish a completed task
    And cancelled inspection cannot supply evidence to a later task

  Scenario: A later query checks a finished Hosted Pi result
    Given a configured Hosted Pi has finished its task
    When the resident checks the original request and complete bounded history
    Then an isolated zero-tool conversation checks the final answer against host coding checks
    And running tasks, changed history, missing checks, and incomplete evidence require review
    And a later source mutation invalidates earlier checks
    And verification never runs a command or replays the task
    And verifier summaries cannot become learned source evidence

  Scenario: Learning uses only a verified completed task
    Given completion verification passed with exact successful receipt citations
    When the learning plugin extracts a reusable lesson
    Then each lesson cites exact successful receipt text from that task
    And reusable source procedures retain their necessary steps and fixed parameters
    And invalid, sensitive, unsupported, or duplicate lessons are not added
    And unrelated explicit user notes remain unchanged
    And learning can be disabled without disabling experience retrieval

  Scenario: Cancellation and plugin failure preserve task truth
    Given a completion check or learning pass is in progress
    When the owner cancels or a plugin fails
    Then cancellation prevents subsequent learning writes
    And the final result reports incomplete verification or learning
    And no stale callback can update the following task

  Scenario: Invalid plugin output receives bounded format feedback
    Given a plugin returns invalid structure or unsupported evidence
    When its existing format correction attempt starts
    Then feedback identifies only a fixed host validation category
    And provider error text and private receipt content do not enter feedback
    And one correction shares the original deadline without tool execution

  Scenario: Skills and MCP use DeskOS installation contracts
    Given an owner requests installation of a Skill or MCP server
    When its declarative package passes the system installation checks
    Then the runtime can discover and use its installed revision
    And installation does not enable arbitrary Pi plugins

  Scenario: Installed Skills remain usable after a resident restart
    Given a Skill installed through a named candidate snapshot
    When a later task starts after a resident restart
    Then the model receives the installed package index
    And it reads the installed Skill resources through fixed DeskOS tools
    And source draft changes do not replace the installed content

  Scenario: MCP calls retain the discovered installed revision and workflow authority
    Given a requested task matches an installed MCP connector
    When the resident discovers and calls its tool through Durable Code Mode
    Then it passes the discovered installed revision and schema-valid arguments
    And a replaced revision requires new discovery before invocation
    And a conversation or inventory-only workflow cannot invoke the connector
    And duplicate mutations share the existing turn-level replay reservation

  Scenario: Temporary and saved agents execute separate tasks
    Given the owner delegates different tasks to child agents
    When a temporary child or a saved identity runs
    Then each child has a separate conversation and explicit capability set
    And temporary children have no durable identity memory
    And saved identities preserve their identity and experience across restarts
    And a running saved child displays its avatar in the conversation

  Scenario: Live acceptance remains separate from offline execution evidence
    Given an explicitly selected live verification run with synthetic reports
    When the real model installs packages and delegates report tasks
    Then host assertions grade the actual tool results and child answers
    And a restarted saved child retains its identity and learned experience
    And paired fresh conversations differ only in accepted learned experience
    And the report separates task success, retrieval, and observed learning benefit
    And a shared request limit stops dependent inference without retry
    And plan inspection makes no external request and reads no credentials

  Scenario: Live custom models use SDK defaults without inventing billing evidence
    Given a configured custom model omits optional cost rates
    When the live runner prepares that exact model for the SDK
    Then synthetic streaming can account for input and output tokens
    And the provider, model identity, API, endpoint, and explicit behavior remain unchanged
    And the private host relay preserves that model selection
    And default zero rates do not establish actual charges or free service
    And normalization reads no authentication store and makes no network request

  Scenario: Live generation limits include provider reasoning tokens
    Given a reasoning model with a larger configured token limit and the default live resources
    When the acceptance runner builds a generation request
    Then the final HTTP payload permits at most 2048 total output tokens
    And a sampling override above that limit is refused before dispatch

  Scenario: Explicit live output resources preserve the default and independent bounds
    Given the default live output limit is 2048 tokens
    When an operator explicitly selects an output limit up to 16384 tokens
    Then the plan, model cap, and actual HTTP adapter use that limit
    And a lower configured model limit reduces both SDK options and the final HTTP allowance
    And duplicate, invalid, and excessive options are refused
    And request counts, deadlines, and quality checks remain unchanged

  Scenario: A live acceptance retry retains the remaining authorization limits
    Given an authorized attempt used part of the request and execution budget
    When an operator starts another isolated attempt
    Then reduced limits cannot exceed the original plan
    And an optional private host relay reaches only the configured HTTP provider
    And the relay closes every connection after acceptance
    And an accepted idle TCP connection can close with an explicit connection reset
    And the listener refuses new connections after shutdown

  Scenario: Task evaluation preserves its fixture boundary
    Given prior natural-language package and identity checks have separate evidence
    When an operator selects task evaluation with prepared synthetic packages and identity
    Then the report marks that setup as a host fixture
    And it does not claim natural-language setup passed in this attempt
    And actual task, completion, restart, and learning checks retain the same limits

  Scenario: Live plugin diagnostics preserve private content
    Given a completion or learning judgment and its actual tool receipts
    When the runner records validation diagnostics
    Then it retains only bounded status, count, and evidence-match facts
    And it identifies the configured model used in that attempt
    And it excludes generated text, quoted text, and receipt content
    And generation diagnostics retain only reported reasoning counts and output truncation counts
    And plugin failures retain only fixed host validation categories
    And tool failures retain only fixed tool identities and error categories
    And report grading retains only a fixed marker category without answer text

  Scenario: Accepted synthetic experience survives an incomplete live evaluation
    Given training has a host-correct result, passed completion, and applied learning
    When the runner continues to later acceptance stages
    Then it first saves only validated accepted experience in a private artifact
    And the report identifies its digest and entry count
    And the artifact excludes conversation history and raw provider responses

  Scenario: Independent continuation preserves accepted learning and experimental controls
    Given a private real training report with correct host grading and accepted experience
    When continuation checks the report, experience schema, and matching digest
    Then it restores only accepted experience without conversation or task history
    And both paired arms receive identical current synthetic input and a shared-method contract
    And both paired arms have MCP access and automatic learning disabled
    And only the candidate receives accepted experience
    And host API admissions are labeled without a coordinator inference claim
    And saved identity persistence is checked across close and reopen
    And the original failed report remains unchanged
