Feature: Personal Agent owns a bounded plugin runtime
  Scenario: Plugin models receive literal receipt text at the provider boundary
    Given a tool returns JSON with quotes, backslashes, Unicode, and misleading receipt headers
    When completion and learning receive that receipt through the actual SDK
    Then each original receipt text occurs once as literal untrusted data
    And host metadata and retry feedback retain every original value
    And only top-level host format correction supplies retry instructions
    And format correction cannot change schema, evidence, privacy, or authority rules
    And embedded headers cannot create receipt identities or grant authority
    And exact citation checks and the shared two-attempt deadline remain unchanged

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

  Scenario: Delivery core acceptance excludes the separate learning experiment
    Given the default live evaluation and isolated synthetic state
    When the real model installs packages and delegates saved and temporary reports
    Then all six core scenarios retain host grading and completion checks
    And a restarted saved child retrieves actual full-entry accepted experience
    And no paired holdout runs or learning benefit claim is included
    And plan inspection makes no external request and reads no credentials

  Scenario: Targeted verification has a fixed and limited scope
    Given targeted saved-report verification or the task-evaluation compatibility option
    When the runner prepares isolated packages and an identity through host APIs
    Then it checks one real saved report execution and completion
    And it claims no natural-language setup, restart, or paired learning coverage

  Scenario: Provider health is a bounded non-mutating diagnostic
    Given an explicit targeted provider-health run
    When the runner sends fixed synthetic input without tools to each provider
    Then it records one generation request and one Jev judgment without response text
    And it claims only provider health and no task or deployment acceptance

  Scenario: External failure policy preserves operation and provider boundaries
    Given a failed operation with its provider and counted request metadata
    When the runner classifies its stop reason
    Then only explicitly temporary HTTP or transport failures permit an explicit targeted retry
    And an operator can use at most one health check and one explicit targeted retry for that provider operation
    And persistent temporary failure requires external-blocked evidence across those reports
    And HTTP 451, configuration, permission, resource, evidence, and quality failures are not retried automatically
    And no complete workflow or mutation is replayed automatically

  Scenario: Live custom models use SDK defaults without inventing billing evidence
    Given a configured custom model omits optional cost rates
    When the live runner prepares that exact model for the SDK
    Then synthetic streaming can account for input and output tokens
    And the provider, model identity, API, endpoint, and explicit behavior remain unchanged
    And the private host relay preserves that model selection
    And default zero rates do not establish actual charges or free service
    And normalization reads no authentication store and makes no network request

  Scenario: Live plugin validation retains the configured bounded timeout
    Given the default plugin timeout is 90000 milliseconds
    When the host explicitly configures a valid plugin timeout up to 180000 milliseconds
    Then the private envelope and isolated Bot use that validated timeout
    And the report records the effective timeout
    And invalid timeouts fail before request dispatch
    And task quality checks and the overall deadline remain unchanged

  Scenario: Live delegation accepts one exact fresh child turn
    Given a saved child completed an earlier task before restart
    When the coordinator uses agent_input on that inactive task
    Then acceptance recognizes the same task handle with exactly one new turn
    And a new handle must start at turn one
    And the requested identity and revision stay fixed through the exact completed turn
    And stale turns, skipped turns, multiple admissions, and different identities fail acceptance
    And finished state, completion verification, and independent report grading remain required

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

  Scenario: Explicit live request resources retain the default and execution bounds
    Given the default live request allowance is 80 shared requests
    When an operator explicitly selects an allowance up to 256 requests
    Then generation and Jev share that exact allowance
    And invalid, duplicate, and excessive options fail before dispatch
    And deadlines, output limits, scenarios, and quality checks remain unchanged
    And request exhaustion requires a refused dispatch, not only an exactly used allowance

  Scenario: Explicit live execution resources preserve the default and quality gates
    Given the default live execution deadline is 900000 milliseconds
    When an operator explicitly selects a deadline up to 1800000 milliseconds
    Then the plan and child report use that exact deadline
    And invalid, duplicate, and excessive options fail before dispatch
    And request, output, and plugin timeout limits remain unchanged
    And all scenarios, validators, and scoring remain unchanged
    And a full acceptance retry starts from the beginning without combining partial results

  Scenario: A live acceptance retry retains the remaining authorization limits
    Given an authorized attempt used part of the request and execution budget
    When an operator starts another isolated attempt
    Then explicit limits respect the remaining authorization and per-attempt safeguards
    And an optional private host relay reaches only the configured HTTP provider
    And the relay closes every connection after acceptance
    And an accepted idle TCP connection can close with an explicit connection reset
    And the listener refuses new connections after shutdown

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

  Scenario: Independent learning evaluation preserves accepted evidence and experimental controls
    Given a private real training report with correct host grading and accepted experience
    When continuation checks the report, experience schema, and matching digest
    Then it restores only accepted experience without conversation or task history
    And both paired arms receive identical current synthetic input and a shared-method contract
    And both paired arms have MCP access and automatic learning disabled
    And only paired holdouts run in new conversation homes
    And every candidate result has correct host grading, passed completion, and actual full-entry retrieval
    And the original source report remains unchanged, including any later failure
    And only the candidate receives accepted experience

  Scenario: An owner replies to the original Pi session message
    Given a durable completion message retains its exact source and session
    When the owner sends text with that message, source key, and source revision
    Then the resident resolves the saved reference before Jev routes the owner text
    And only the uniquely configured matching project and session can receive a follow-up
    And stale, ambiguous, unavailable, or unknown delivery references cannot send or replay a prompt
    And native list summaries and full status records can differ without changing the original session
    And native identity requires an explicit protocol discriminator or a reviewed host configuration
    And conflicting endpoint declarations refuse delivery
    And Hosted list previews establish identity without supplying an admission revision
    And Hosted replies use the fresh status revision for daemon admission CAS
    And a revision change after that status read refuses the prompt
    And native historical unknown receipts do not block an independent explicit owner operation
    And an unresolved bound owner reply still blocks its original message and any unfinished continuation
    And no replacement task or freely supplied target can receive the reply
    And the owner turn and receipt retain the original message and stable session thread
    And later completion revisions retain that same thread after restart

  Scenario: Interrupted owner replies retain truthful delivery state after restart
    Given an owner reply was saved before delivery or while delivery was in progress
    When the resident restarts without replaying the owner turn
    Then a queued reply becomes failed and an in-progress delivery becomes unknown
    And its original message reference, thread, text, time, and receipt remain unchanged
    And completed and unknown replies retain their existing states
    And a reporting-machine mapping change cannot release unknown delivery
    And missing origin history keeps a conservative unknown-session lock
    And a second restart performs no checkpoint write or model or task call

  Scenario: Reply writes use the same private checkpoint contract as restart reads
    Given a reply text or model answer contains a forbidden control character
    When the resident prepares the reply checkpoint
    Then the shared reply validator rejects the complete snapshot before any write
    And the previous delivery state and mutation receipt remain byte-for-byte unchanged
    And ordinary Chinese text, line breaks, and tabs remain valid

  Scenario: Every owner reply retains a session identity
    Given session replies have not been released as an optional-identity format
    When a reply checkpoint omits its session identity or uses an empty identity
    Then the same read and write validator rejects it without changing the checkpoint
    And an unknown reply with expired origin history blocks only its retained session
    And another explicitly identified session can receive an owner reply

  Scenario: Provider selection keeps OpenCode Console and Go separate
    Given the operator selects a model provider and its explicit credential
    When the resident configures model transport or a Jev judgment
    Then Console uses its fixed inference endpoint for the selected API family
    And Go uses its separate credential and inference endpoint
    And Go cannot supply a System One judgment or borrow Console credentials
    And provider-scoped SDK credentials remain supported without ambient credential fallback
    And disabled Jev performs no authentication request
    And existing typed judgment validation and authorization rules remain unchanged

  Scenario: Optional judgments expose the current provider and validated answers
    Given Jev returned a valid judgment before a delayed startup health failure
    When that failure selects the ordinary judgment service
    Then readiness immediately names the ordinary model without another Jev request
    And Jev responses expose only validated answer fields and their real model identity

  Scenario: Ordinary typed routing does not require a generated probability table
    Given the ordinary model selects among many fixed route criteria
    When it returns one exact choice and a bounded confidence
    Then the host derives the compatibility distribution without changing confidence
    And low confidence cannot pass the existing decision gates
    And the host does not label derived values as calibrated provider probabilities
    And Jev retains full typed primitive validation

  Scenario: A new owner request follows a later completed session message
    Given an earlier owner reply retains an unknown admission receipt
    And a later durable assistant update has a different real completion identity for the same session
    When the owner replies with different text to that exact later message
    Then the resident can admit one new reply without changing the unknown receipt
    And the earlier message, repeated text, missing origin, and unfinished sources remain blocked
    And dispatch rechecks the completion boundary before any prompt leaves the resident
    And concurrent delivery or another reply without a later completion remains blocked
    And the next completed message can continue the same thread after restart

  Scenario: AI selects an existing task for a new owner message
    Given a displayed Pi completion and its configured control binding
    When the owner names that task without a reply reference
    Then initial AI classification can read bounded untrusted task context
    And missing or stale source choices create no reply and can be corrected within that turn
    And the host binds the selected source to the original owner text
    And a valid source reserves its single attempt before saving or publishing
    And one owner turn cannot create another reply operation
    And later distinct requests require a new completed turn after unknown delivery

  Scenario: Fresh Pi work differs from reading retained task results
    Given an owner names an existing Pi task without a reply reference
    When the owner asks that Pi to inspect a file again
    Then classification selects the existing-session workflow even for read-only work
    And a request for retained status or results selects the task-query workflow
    And confidence measures workflow meaning rather than session control authority
    And confidence below 0.8 still requires clarification
    And the selected handler must validate the exact session and permission before delivery

  Scenario: A selected task retains one owner message in its thread
    Given an owner instruction without a reply reference
    When AI selects a retained task and the host binds its source
    Then the first thinking frame and durable reply share one host-generated identity
    And the Personal Agent answer belongs to that same reply
    And a failed binding sends no instruction and retains a failed record

  Scenario: Session follow-up acknowledgements use concise owner language
    Given a follow-up has an actual delivery receipt and internal verification result
    When the Personal Agent acknowledges the instruction
    Then it uses one or two short sentences in the owner language
    And unknown delivery does not claim sending, receipt, execution, or completion
    And identifiers and protocol fields remain internal unless the owner requests them
    And an unverified result remains visible without implementation terminology

  Scenario: An uncertain native receipt cannot certify sending
    Given a native receipt has accepted false and delivery unknown
    When the Personal Agent acknowledges the owner instruction
    Then it says receipt or submission cannot be confirmed
    And it does not prefix that uncertainty with a claim that the instruction was sent
