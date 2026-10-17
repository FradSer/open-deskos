Feature: Owner controlled proactive Personal Bot proposals
  Proposals are read-only agent state, never plugin instructions or authorization.

  Scenario: Recommendations do not assert that an action already happened
    Given fresh observations explicitly report a pending need and its deadline
    When generated advice recommends addressing that need without adding facts
    Then Jev evaluates the recommendation separately from factual assertions
    And invented deadlines, causes, permissions and completed actions remain unsupported

  Scenario: A judgment fluctuation cannot repeat an acknowledged suggestion
    Given the Shell acknowledged a generated suggestion
    When Jev rejects it once and later accepts the same intent and observations
    Then the previous proposal identity and acknowledgement are preserved
    And no automatic popup repeats after a service restart
    But materially changed observations can create a new suggestion

  Scenario: Generate several suggestions before Jev selects what to push
    Given owner goals and fresh observations from arbitrary subscribed services
    When a heartbeat or selected service event arrives
    Then the generation model returns zero or more evidence-referencing suggestions
    And Jev independently judges every candidate in one batch
    And only its selected candidates are presented, ordered by judgment probability
    And generated advice cannot supply tools, permissions or fabricated evidence

  Scenario: Generic generation preserves source and lifecycle boundaries
    Given a generated batch is in flight
    When newer service facts arrive or the owner suppresses the topic
    Then the older batch cannot publish
    And malformed generation or unavailable models produce no fixed-advice fallback
    And stable candidate keys, quiet hours and cooldown prevent repeat delivery

  Scenario: Heartbeat asks Jev whether to suggest now
    Given fresh owner-selected readings and an idle personal bot service
    When the periodic heartbeat refreshes application state
    Then Jev judges the relevance of the candidate advice in one typed request
    And only an affirmative Jev result may create a proposal
    And numeric owner criteria alone cannot create a proposal

  Scenario: A service push asks Jev without waiting for the heartbeat
    Given an authenticated service reports a changed owner-selected reading
    When the personal bot service receives its bounded reading identifiers
    Then it rereads authoritative Open DeskOS Data and asks Jev with a service-push trigger
    And pushed advice, action parameters and arbitrary data cannot enter the judgment

  Scenario: Pushes during inference supersede the older observation
    Given a heartbeat Jev request is in flight
    When one or more service updates arrive
    Then the outdated result cannot activate a proposal
    And the queued updates are coalesced into another judgment with fresh readings

  Scenario: Jev failure never falls back to threshold delivery
    Given missing credentials, timeout, invalid output or an unavailable Jev service
    When a heartbeat or service update occurs
    Then no new suggestion is presented and unavailable judgment is reported
    And ordinary voice and explicit action confirmation remain available

  Scenario: An unjudged topic cannot hold suggestions unavailable
    Given a generation or judgment failure was reported for a topic
    When a later round has no fresh observation for that topic, or the owner muted it
    Then its older failure cannot keep judgment unavailable
    And a topic with fresh observations can still produce a suggestion
    And an empty current coding task list clears its older judgment failure
    And a superseded read cannot clear a failure before the current round runs

  Scenario: Device E2E joins real Jev to the private channel and Electron panel
    Given an isolated Hydra store, private voice channel and disposable Electron profile
    When a real Jev heartbeat judges ordinary soil and then dry soil
    Then ordinary soil stays hidden and dry soil opens the nonmodal evidence panel
    And the Shell acknowledgement reaches the private checkpoint without another popup
    When an isolated Hydra message reports dry soil through the trusted source callback
    Then a real Jev service-push judgment reaches the same Electron panel
    And a UI ignore writes only the isolated owner cooldown
    And failed inference cannot produce a proposal or action

  Scenario: Enabled reading advice is delivered without a question
    Given the example weather or combined soil and weather rule matches fresh readings
    And the personal bot service is idle outside quiet hours
    When the watch starts its background polling without any owner input
    Then an evidence-bearing proposal automatically activates the nonmodal panel
    And later polls refresh that pending proposal without another popup or action

  Scenario: Asking for recent suggestions returns current proposals
    Given a current weather proposal and unrelated old session history
    When the owner asks "最近有什么建议"
    Then the host refreshes the proposal evidence and answers with the current advice and measurement
    And it does not ask the model to describe capabilities or reuse old tasks
    And it does not execute any proposed action

  Scenario: No current suggestion is reported truthfully
    Given no pending proposal or an unavailable proposal store
    When the owner asks for suggestions
    Then the answer reports no current suggestion or unavailable data respectively
    And ignored, expired and completed advice is not recommended again

  Scenario: A suggestion query waits for an active source refresh
    Given a source refresh is already in progress
    When the owner asks for suggestions
    Then the answer waits for that refresh instead of reporting the previous reading

  Scenario: Dry soil creates a read-only proposal
    Given live Hydra soil below an owner threshold with a recent measured time
    When the watch polls Open DeskOS Data
    Then one evidence-bearing proposal appears and no action tool runs

  Scenario: A previously live measurement expires
    Given a pending proposal
    When its source becomes stale, unavailable or exceeds the owner's freshness limit
    Then it is marked expired with the original measurement time and cannot execute

  Scenario: A voice turn defers a proposal
    Given a Spoken Turn is recording, transcribing or working
    When a rule matches
    Then the proposal stays pending until the turn ends

  Scenario: Quiet hours and silent delivery
    Given owner quiet hours or a silent rule
    When a nonurgent rule matches
    Then it stays queued until the owner asks or next interacts

  Scenario: Pending proposals merge and acknowledged rules cool down
    Given a proposal for the same rule and subject already exists
    When the rule matches again
    Then evidence is refreshed without another popup

  Scenario: Confirmation is exact and execution is sequential
    Given the owner has seen a proposal with an exact confirmation phrase
    When a subsequent user turn or explicit touch confirmation supplies that phrase
    Then the existing tool runs once and its result returns to the Personal Bot panel
    But vague agreement, stale evidence and unknown outcomes cannot replay it

  Scenario: Ignore and mute belong to the owner
    Given a displayed proposal
    When the owner ignores it or chooses never suggest this category
    Then ignore cooldown or rule suppression is saved in the private owner configuration

  Scenario: Suggestions are answered from agent state
    Given pending, ignored and expired proposals
    When the user asks what suggestions are available
    Then the agent reports those distinct states from its proposal store

  Scenario: Empty and untrusted data cannot activate the panel
    Given no matching owner rule or a package publishing instruction text
    When the watch polls
    Then no proposal popup or action occurs

  Scenario: Threshold and combined source rules
    Given fresh soil and weather readings meet the owner's combined predicates
    When the watch evaluates both readings
    Then one proposal retains evidence from both sources

  Scenario: Routine delivery happens once at the owner's time
    Given a routine rule with a scheduled local time
    When the schedule becomes due
    Then it is presented once that day subject to quiet hours and cooldown

  Scenario: Hosted Pi turn completion is separate from verification
    Given a configured session was observed working
    When coding_task_status reports a finished idle turn
    Then a proposal names target, project, task identity and observed outcome
    And it states verification separately and offers to read coding_task_history

  Scenario: Restoration initialization does not establish a new coding turn
    Given a saved turn finished before its session expired
    When restoration is cancelled, ended, or fails before a new turn begins
    Then event observation and status polling do not announce another completion
    And repeated restoration attempts do not announce the old result
    But a live working turn or a legacy running turn can still establish a new completion

  Scenario: Active local input remains authoritative
    Given focus is on a local Shell control
    When a proactive proposal is presented
    Then one nonmodal Personal Bot panel appears without moving focus or disabling Shell controls

  Scenario: Presentation acknowledgement survives restart
    Given the Shell acknowledged a pending proposal
    When the personal bot service restarts
    Then exact subsequent confirmation still works without repeating an action

  Scenario: Lost delivery recovers without repeating a routine schedule
    Given a popup was checkpointed but never acknowledged
    When the service restarts
    Then immediate delivery retries while routine delivery waits for explicit interaction

  Scenario: Saved proposal state cannot authorize a new action
    Given saved proposal action parameters disagree with the current owner rule
    When the service restores private state
    Then the proposal expires and no action runs

  Scenario: Private checkpoint failure is visible
    Given private proposal state cannot be saved
    When the watch evaluates a rule
    Then the Shell reports suggestions unavailable and no action runs

  Scenario: Explicit suggestions query can reopen pending proposals
    Given an acknowledged proposal remains pending after owner configuration save failed
    When the owner explicitly asks for suggestions after restart
    Then the proposal can be displayed again after the active voice turn
    And exact confirmation remains available without another automatic scheduled popup

  Scenario: Private modules can create shared state ancestors in any order
    Given the private state directories do not exist
    When package installation creates state before the first child task
    Then each new directory receives private permissions before its children are created
    And experience and child tasks can use the same protected parent directories
    And unsafe existing directories remain unchanged and refused

  Scenario: Windows checks each private ACL without a command processor
    Given a private Windows state directory
    When Durable storage repeatedly reads or writes private state
    Then every operation checks the current owner and access rules through native APIs
    And no permission check starts a command processor
    And changed or missing access rules are refused without repair
    And new files receive private permissions before content is written

  Scenario: Windows stores owner rules and action receipts with private ACLs
    Given the Windows Shell Host runs under its configured user
    When proactive owner rules and checkpoint state are read or written
    Then only that user, SYSTEM and Administrators may access them
    And broad access, links and malformed state disable suggestions
    And atomic file checkpoints work without POSIX uid or directory fsync

  Scenario: Unsupported attributes are vetoed despite a high support score
    Given a generated suggestion adds an attribute absent from selected observations
    When Jev reports high usefulness and support but detects the unsupported assertion
    Then no proposal is created

  Scenario: Large real observation batches have a bounded generation budget
    Given generation takes longer than 30 seconds but less than 90 seconds
    When the heartbeat or a selected service push requests suggestions
    Then generation can complete without the old 30 second cancellation
    And timeout or owner cancellation still aborts and disposes the isolated session

  Scenario: Service environment owns proactive generation configuration
    Given the Personal Bot receives an isolated service environment
    When the process environment has a different or invalid generation timeout
    Then the service value is used when configured
    And an omitted service value uses the bounded default without reading the process value

  Scenario: Actual weather and service observations are configured
    Given the owner enables current weather condition and current holdings fields
    When a heartbeat or those services push an update
    Then the generator receives only the selected fresh authoritative observations

  Scenario: Independent service updates do not starve unrelated suggestions
    Given several owner topics depend on different live sources
    When one source pushes while another topic is generating or being judged
    Then only candidates depending on the changed source are discarded
    And unchanged topics can finish their judgment and delivery

  Scenario: Conversational Intent conditions precede ride discovery
    Given the owner saves a natural language daily Intent through a Jev-routed turn
    When the existing heartbeat enters its local time window
    Then Jev checks the condition against relevant Memory and fresh observations before MCP discovery
    And unknown conditions cause no ride search or estimate
    And a missed window does not trigger late catch-up

  Scenario: Intent revisions reserve discovery and invalidate stale results
    Given a private proposal checkpoint claims an Intent occurrence before discovery
    When the service restarts or another heartbeat occurs on the same local day
    Then it does not repeat discovery or popup
    And editing or muting the Intent invalidates late responses
    And failed occurrences remain queryable without replay

  Scenario: Ride details cannot authorize a paid order
    Given real MCP search candidates and a current estimate
    When the owner opens the ride suggestion
    Then the view shows actual candidates and quote expiry without ordering
    And ambiguous places require an explicit owner choice
    And continuing enters the Jev-routed ride workflow with reviewed handles
    And only a later exact owner confirmation can submit an order

  Scenario: Intent windows and history remain safe across days
    Given a daily Intent window crosses local midnight
    When a heartbeat occurs inside that window
    Then its occurrence belongs to the preceding local date
    And bounded old history archives outcome counts without blocking new days
    And a persisted date watermark prevents clock rollback from replaying archived discovery

  Scenario: Real context updates invalidate Intent work
    Given an enabled Intent selects a real desk observation
    When the existing service push reports that observation changed
    Then the Watch accepts that source identifier and rejects its older condition or preview result
    And a newer context can receive a new condition judgment before any discovery started

  Scenario: Unchanged Intent context does not repeat paid condition judgments
    Given a negative or unknown condition judgment with unchanged selected Memory and source values
    When another heartbeat observes that same context
    Then it reuses the bounded private judgment checkpoint
    And a relevant context change permits a fresh judgment
    And a context-only Intent has at most one clock-driven recheck each hour

  Scenario: Relevant Memory changes the real ride discovery
    Given an owner Intent references named company, gym, and city notes
    When those actual notes supply different gym values on different occurrences
    Then the real MCP search receives the corresponding current note value
    And changing a relevant note rejects older preview handles and late quotes
    And an explicitly named owner route overrides conflicting older notes
    And saved places never establish the owner's current location

  Scenario: The owner refreshes restored ride details without replaying a scheduled offer
    Given a restart expired a saved ride preview and its volatile handles
    When the owner explicitly reads suggestions and selects Refresh preview
    Then the request enters the normal Jev-routed owner text channel
    And current unchanged Intent data supplies a fresh read-only MCP search
    And new place handles require a new owner selection
    And manual reading works after the daily offer window without adding an occurrence or automatic popup
    And changed or muted Intents cannot restore old handles or order confirmation

  Scenario: The Intent plugin requires the personal profile
    Given the coding profile has no private owner Memory
    When its configuration selects the fixed Intent plugin
    Then configuration and runtime creation reject that unsupported combination
    And no provider or background Intent work starts

  Scenario: A fast Hosted turn has a distinct completion identity
    Given an owner receives a real Hosted launch or restoration receipt
    When the new turn finishes before the next watch poll
    Then its host-generated terminal turn identity establishes one completion notice
    And restoration without a new turn cannot announce the preserved result
    And reading historical completion identities does not create a notice
    And ending or restarting the host preserves a completed new turn identity
    And metadata changes retain an unconsumed notice for that same terminal turn

  Scenario: A direct remote prompt completes between watch polls
    Given the watch already observed the task's previous terminal identity
    When Console or remote follow-up completes a new turn before the next poll
    Then the changed terminal identity establishes one new completion notice
    And a first scan of that finished task does not establish a new turn

  Scenario: A legacy completed turn survives a daemon restart
    Given the watch observed the legacy session working without a terminal identity
    When the daemon restarts after that turn finishes
    Then its preserved finished outcome can establish completion
    But cold history and restoration preparation cannot establish completion
