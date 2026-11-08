Feature: Owner controlled proactive Personal Agent proposals
  Proposals are read-only agent state, never plugin instructions or authorization.
  Generated text never supplies action authority. Owner-approved catalogs define executable actions.

  Scenario: One approved Gmail action prepares an unsent reply
    Given a current Gmail recommendation offers review and reply preparation
    And the host has a reply preparation callback
    When the owner confirms the selected reply preparation action
    Then the host reads the same private message before generating a draft
    And the draft can complete while its own turn marks the agent busy
    And the host rechecks the same source after generation
    And only a current source permits the draft in the local Personal Agent conversation
    And one recommendation selects only one suggested action
    And the draft response is marked ownerOnly
    And public conversation checkpoints and Android projections omit that response
    And the receipt records a read-only unsent reply
    And a failed or revoked operation publishes no draft and cannot replay
    And a missing reply callback withdraws only reply preparation

  Scenario: A Gmail meeting change conflicts with the owner's calendar
    Given the owner authorizes background access to one Gmail account and one calendar
    And the calendar has the prior meeting and a different busy event
    When a newer Gmail scheduling request moves the meeting into that busy interval
    Then one read-only suggestion in the Personal Agent conversation identifies both sources
    And no model or mutation tool receives the source data

  Scenario: Private observations and generation failures stay within their topics
    Given the Watch observes a private message and an ordinary reading
    When it generates suggestions
    Then each private message has its own model request
    And an unrelated generation failure cannot block acknowledgement or confirmation
    When the private source binding becomes invalid
    Then the Watch removes the private card from status and suggestion queries

  Scenario: An Intent uses the selected field's own freshness
    Given a Hydra snapshot is current but the selected plant reading is stale
    When the Watch evaluates a soil-moisture condition
    Then no condition judgment or suggestion uses that stale value
    When a fresh soil reading arrives
    Then the suggestion retains the time of that field's measurement
    When the source republishes the same live value
    Then the Watch refreshes the evidence on the same suggestion
    And it makes no new condition judgment
    When the selected value changes
    Then the previous suggestion expires

  Scenario: A schedule conflict expires across a wall-clock jump
    Given an offered schedule conflict has a future start time
    When wall time passes its start while the timer is paused
    Then the next bounded timer withdraws the pending card before reading a provider
    And an early timer does not read a provider

  Scenario: Repeated reads do not create another suggestion for the same change
    Given a calendar conflict suggestion has been shown or ignored
    When a poll, a source update, or a restart repeats the same meeting revision
    Then the Watch keeps the same suggestion identity and owner decision
    And a newer change or cancellation rechecks the same meeting

  Scenario: A timer wakes a pending suggestion when it becomes due
    Given a conflict suggestion is deferred or has a future expiry
    When that deadline passes before the next heartbeat
    Then the Watch rechecks a deferred suggestion or expires it without waiting for a source update

  Scenario: A timed Intent starts within its window between heartbeats
    Given a timed Intent starts at 09:30 and its window is ten minutes
    And the Watch starts at 09:15 with a thirty-minute heartbeat
    When the time becomes 09:30
    Then the Watch evaluates the Intent without a source push
    And the Watch does not evaluate a missed window after wake

  Scenario: A missing grant or insufficient evidence prevents a calendar suggestion
    Given the owner grant is absent or the current Gmail account differs from the grant
    When the Watch runs
    Then the Watch does not use that source for a calendar suggestion
    And stale or incomplete calendar data cannot establish a conflict

  Scenario: A generated recommendation selects a currently executable owner action
    Given the owner configures a bounded action catalog for a recommendation topic
    And the selected Agent can execute one configured action
    When the generator selects that action identifier
    Then the host binds its label and exact parameters without model supplied permissions
    And an unavailable action cannot create a new recommendation card
    And execution requires presentation and the exact owner confirmation
    And uncertain receipts and restarted execution cannot replay the action
    And Intent previews remain read-only

  Scenario: Stopping the Watch cancels a pending action confirmation read
    Given a presented executable recommendation waits for a source read during confirmation
    When the Watch stops before that read completes
    Then no action executes after the source read returns
    And no late presentation is published

  Scenario: Dispatch rechecks the Watch after asynchronous confirmation work
    Given a confirmed action waits for source reads or executor routing
    When its source revision, selected capability, owner action, or Watch lifecycle changes
    Then the actual tool dispatch refuses the obsolete action
    And a reserved action retains an unknown result without replay

  Scenario: Uncertain effects cannot be retried through changed model or owner labels
    Given an owner action has an executing or unknown outcome
    When generated keys, advice, observations, or owner rule versions change
    Then the same tool and exact parameters cannot create another executable card
    And an already pending duplicate cannot execute
    And the original mutation receipt survives restart
    And an independent approved action remains available

  Scenario: Action selection requires explicit string identifiers
    Given an ordinary owner action catalog or generated selection omits an action identifier
    When the host validates that value
    Then validation rejects the missing or non-string identifier

  Scenario: Trusted Intent previews keep their read-only recommendation format
    Given a ready Intent provides current preview observations
    When its generator proposes read-only preview advice
    Then the preview contains concise advice and a concrete owner next step
    And the generator does not return a reason field
    And source hashes remain in the cited observations
    And preview details do not grant an order or execution permission

  Scenario: Intent generation repairs a missing advice field without changing its authority
    Given a ready Intent has current ride preview evidence
    When the first generated candidate has a next step but omits advice
    Then validation rejects that candidate before publication
    And one correction identifies the missing advice field with complete valid JSON examples
    And both ordinary and Intent examples retain advice and their own evidence identifiers
    And only a corrected candidate with advice and a next step can pass
    And two responses without advice fail without a generated fallback or new permission

  Scenario: Useful feedback preserves a completed read-only Intent preview
    Given the real Watch presents a completed Intent preview with current route handles
    When the owner marks the recommendation useful or starts another owner turn
    Then the recommendation remains pending and its route handles remain readable
    And a completed manual preview retains the same read-only validity
    And memory, source, Intent, time, expiry, or Watch lifecycle changes still invalidate it
    And interaction during condition, discovery, refresh, or generation still cancels that unfinished work
    And feedback never grants order or action permission

  Scenario: Presentation receipts recheck observation freshness
    Given offered routine recommendations have timestamped observations
    When a presentation receipt arrives after some observations expire
    Then expired recommendations remain unacknowledged
    And only fresh recommendations consume their routine presentation day
    And observations at the freshness limit still allow acknowledgement

  Scenario: Recommendation selection does not erase an unresolved need
    Given several fresh recommendations exceed the automatic presentation budget
    When the watch selects the next recommendations to present
    Then all supported needs remain pending
    And urgent eligible needs precede routine or silent recommendations

  Scenario: A changed need has a new occurrence
    Given the owner saw a recommendation
    When its selected observation values change without changing its semantic key
    Then a new occurrence can be presented
    But timestamp-only refreshes retain the original acknowledgement
    And a need that clears and returns has a new durable observation episode

  Scenario: Feedback applies to one recommendation occurrence
    Given two recommendations belong to one topic
    When the owner marks one done, irrelevant, incorrect, or ignored
    Then the same handled occurrence cannot return after regeneration or restart
    And the other recommendation remains available
    When the owner postpones one recommendation
    Then only that occurrence waits until its saved snooze deadline
    And an explicit snooze can resume a routine occurrence after its daily acknowledgement
    And useful feedback records no action or completion

  Scenario: Stable observations reuse bounded generation work
    Given unchanged semantic observations and a recent successful generation
    When a heartbeat refreshes only measurement timestamps
    Then the watch refreshes evidence without another generation request
    And changed observations or an elapsed generation interval permit another request
    And each round has a bounded number of generation attempts

  Scenario: A failed topic does not disable healthy recommendations
    Given one topic fails generation
    When another topic has a supported recommendation
    Then the healthy recommendation remains readable and dismissible
    And the failed topic remains reported as unavailable

  Scenario: Recommendations do not assert that an action already happened
    Given fresh observations explicitly report a pending need and its deadline
    When generated advice recommends addressing that need without adding facts
    Then the host binds every visible number and timestamp to an approved observation
    And invented deadlines, causes, permissions and completed actions remain unsupported

  Scenario: A repeated generation cannot repeat an acknowledged suggestion
    Given the Shell acknowledged a generated suggestion
    When a later heartbeat generates advice for the same intent and observations
    Then the previous proposal identity and acknowledgement are preserved
    And no automatic popup repeats after a service restart
    But materially changed observations can create a new suggestion

  Scenario: The generation model alone decides which suggestions exist
    Given owner goals and fresh observations from arbitrary subscribed services
    When a heartbeat or selected service event arrives
    Then the generation model returns zero or more evidence-referencing suggestions
    And every structurally valid candidate becomes a pending proposal without a second model judgment
    And supported candidates remain pending independently of the presentation budget
    And due time and urgency precede creation time for eligible presentations
    And generated advice cannot supply tools, permissions or fabricated evidence

  Scenario: The generation Agent investigates through one scoped tool
    Given a generation round supplies topics with cited owner-selected readings
    When the ephemeral Durable session starts
    Then only the scoped read-only tool is visible and callable by the generation model
    When the model needs context beyond the cited fields
    Then it can reread a cited reading through that tool
    And a reading outside the round's citations is refused
    And read calls stay within a bounded budget
    And no Skill, project context, owner memory or persisted transcript becomes available

  Scenario: The generation session has no judgment tool
    Given a generation round supplies topics with cited owner-selected readings
    When the ephemeral Durable session starts
    Then only the scoped read-only reread tool is visible to the model
    And no draft self-check or score can change which suggestions the model returns

  Scenario: Text and visuals complement through composition, not a separate gate
    Given a generated candidate carries advice and a generic preview
    When the generation instructions shape the message
    Then the advice states meaning and the preview carries distinct readings
    And equal values for distinct facts remain valid when each part adds information
    And the generation instructions shape presentation, not a separate score

  Scenario: Advice reports only what the observations state
    Given a topic reports measured values and their difference
    When the generator writes advice
    Then the advice states the measured change without adding a consequence, risk, likelihood or outcome that no observation states
    And the advice does not add a second clause that restates the first
    And a plain factual sentence remains valid

  Scenario: Preview summary adds meaning instead of a report heading
    Given a candidate has measurements the owner should see
    When the generator writes the preview
    Then preview.summary is omitted when the item labels already explain the readings
    And any summary is one short plain phrase, not a report heading or a restatement of advice
    And each item label is a short plain noun phrase without redundant qualifiers

  Scenario: Generation context carries each fact once
    Given the host prepares a generation round for several topics
    When it builds the model prompt and input
    Then the output contract is declared once and reused by the format correction
    And the model input omits host-only bookkeeping fields
    And repeated observation metadata is declared once per topic
    And the safety boundary remains in force exactly once
    And the generated output still validates against the same contract

  Scenario: The host rejects unresolved template markers in a semantic key
    Given a generated candidate names its semantic key
    When the host validates the batch
    Then a key containing braces or template markers is refused
    And a missing or non-string key is refused
    And a plain key that matches the host allowlist is accepted

  Scenario: A preview carries only the readings behind the advice
    Given a topic exposes more observations than the advice needs
    When the generator builds the preview
    Then preview.items contains at most three pairs that support the stated change
    And unrelated readings, technical identifiers and diagnostics stay out of the preview
    And a preview with a fourth pair is rejected before publication

  Scenario: Advice reads as one natural sentence without repeating the action
    Given a topic supplies an approved action with a visible label
    When the generator writes advice for that topic
    Then the advice states what changed in short natural language
    And the advice does not restate the action label or tell the owner to use the control
    And the advice uses no report-style phrasing such as a noun plus 为 plus a figure
    And preview labels read as plain noun phrases without bracketed units
    And a draft that restates the action label fails validation

  Scenario: One generated batch publishes every valid candidate
    Given one round supplies several distinct candidates
    When the host validates the generated batch
    Then each candidate is checked against its own goal, actions and cited observations
    And no candidate is dropped because another candidate in the batch is weak
    And every structurally valid candidate can publish in the same round

  Scenario: Host validation is the only gate after generation
    Given the generation model returned a batch of candidates
    When the host validates that batch
    Then it binds actions, evidence, visible facts and freshness mechanically
    And no second model judgment stands between a valid candidate and the owner

  Scenario: The host binds visible claims to cited observations
    Given a candidate states a measured value and adds no invented fact
    When the host validates the candidate
    Then every visible number and ISO timestamp resolves to an approved observation
    And an invented or recomputed value is refused before publication
    And free-prose meaning stays constrained by generation rules, not by a score
    And no model probability stands in place of that binding

  Scenario: The host binds Intent next steps to cited observations
    Given a generated Intent preview carries a model-written next step
    When the host validates the card
    Then every number and timestamp in the next step resolves to a cited observation
    And an invented deadline, count or location value is refused before publication

  Scenario: The host states the limit of mechanical fact binding
    Given free-prose advice contains a causal, permission or completion claim
    When the host validates the card
    Then the generation instructions forbid that unsupported claim
    And the host does not claim to bind free-prose meaning mechanically
    And presentation labels remain outside the measured-value check

  Scenario: A pending proposal without a judgment record survives restart
    Given a generated candidate has published a pending proposal
    When the service restarts from its private checkpoint
    Then the proposal stays pending with its acknowledgement state
    And no missing judgment field expires it

  Scenario: The host binds values from the full approved observation set
    Given a topic approves several observation fields for one round
    When the generator cites only one of those fields
    Then the host can bind a visible number supplied by any approved field
    And the record retains the full approved observation set

  Scenario: A derived number must be an approved observation value
    Given observations report two measured numbers but not their difference
    When the generator writes the difference as advice
    Then the host refuses that number unless an approved observation supplies it

  Scenario: Every approved observation supports the generated claim
    Given a topic supplies several owner-selected observation fields
    When the generator cites only some of them
    Then the host binds the full approved observation set to that candidate
    And the model-selected subset cannot leave a stated claim unsupported
    And the candidate still cites only observations belonging to its own topic

  Scenario: A generation timeout does not fan out into isolated retries
    Given one round supplies several topics
    When the generation session exhausts its time budget
    Then the host reports that round as unavailable without generating again
    And a transport timeout is not treated as one malformed topic
    And a later round can still generate for the same topics

  Scenario: Generation instructions ask for one suggestion per current need
    Given the generation contract supplies several topics
    When the model writes suggestions
    Then the instructions ask for one suggestion for each topic with a current need
    And the instructions require an empty batch when no observation shows a need
    And no tool tells the model to drop a weak draft

  Scenario: Generic generation preserves source and lifecycle boundaries
    Given a generated batch is in flight
    When newer service facts arrive or the owner suppresses the topic
    Then the older batch cannot publish
    And malformed generation or unavailable models produce no fixed-advice fallback
    And stable candidate keys, quiet hours and cooldown prevent repeat delivery

  Scenario: Heartbeat asks the generation model whether to suggest now
    Given fresh owner-selected readings and an idle Personal Agent service
    When the periodic heartbeat refreshes application state
    Then the generation model returns an empty batch when no need exists
    And a non-empty batch creates proposals without a second judgment request
    And numeric owner criteria alone cannot create a proposal

  Scenario: A service push asks generation without waiting for the heartbeat
    Given an authenticated service reports a changed owner-selected reading
    When the Personal Agent service receives its bounded reading identifiers
    Then it rereads authoritative Open DeskOS Data and generates with a service-push trigger
    And pushed advice, action parameters and arbitrary data cannot enter generation

  Scenario: Pushes during generation supersede the older observation
    Given a heartbeat generation is in flight
    When one or more service updates arrive
    Then the outdated result cannot activate a proposal
    And the queued updates are coalesced into another generation with fresh readings

  Scenario: A classifier failure cannot disable recommendations
    Given the Jev classifier is missing, disabled or unavailable
    When a heartbeat or service update occurs
    Then generation and host validation still determine which proposals appear
    And ordinary voice and explicit action confirmation remain available

  Scenario: A stale generation failure cannot hold suggestions unavailable
    Given a generation failure was reported for a topic
    When a later round has no fresh observation for that topic, or the owner muted it
    Then its older failure cannot keep suggestions unavailable
    And a topic with fresh observations can still produce a suggestion
    And an empty current coding task list clears its older generation failure
    And a superseded read cannot clear a failure before the current round runs

  Scenario: Device E2E joins generation to the private channel and Electron panel
    Given an isolated Hydra store, private voice channel and disposable Electron profile
    When a heartbeat generates no advice for ordinary soil and one for dry soil
    Then ordinary soil stays hidden and dry soil opens the nonmodal evidence panel
    And the Shell acknowledgement reaches the private checkpoint without another popup
    When an isolated Hydra message reports dry soil through the trusted source callback
    Then a service-push generation reaches the same Electron panel
    And a UI ignore writes only the isolated owner cooldown
    And failed inference cannot produce a proposal or action

  Scenario: Enabled reading advice is delivered without a question
    Given the example weather or combined soil and weather rule matches fresh readings
    And the Personal Agent service is idle outside quiet hours
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
    Then the existing tool runs once and its result returns to the Personal Agent panel
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
    Then one nonmodal Personal Agent panel appears without moving focus or disabling Shell controls

  Scenario: Presentation acknowledgement survives restart
    Given the Shell acknowledged a pending proposal
    When the Personal Agent service restarts
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

  Scenario: Unsupported attributes are vetoed by host binding
    Given a generated suggestion adds a value absent from selected observations
    When the host validates the card
    Then the unbound value is refused before publication
    And no proposal is created

  Scenario: Large real observation batches have a bounded generation budget
    Given generation takes longer than 30 seconds but less than 90 seconds
    When the heartbeat or a selected service push requests suggestions
    Then generation can complete without the old 30 second cancellation
    And timeout or owner cancellation still aborts and disposes the isolated session

  Scenario: Service environment owns proactive generation configuration
    Given the Personal Agent receives an isolated service environment
    When the process environment has a different or invalid generation timeout
    Then the service value is used when configured
    And an omitted service value uses the bounded default without reading the process value

  Scenario: Actual weather and service observations are configured
    Given the owner enables current weather condition and current holdings fields
    When a heartbeat or those services push an update
    Then the generator receives only the selected fresh authoritative observations

  Scenario: Independent service updates do not starve unrelated suggestions
    Given several owner topics depend on different live sources
    When one source pushes while another topic is generating
    Then only candidates depending on the changed source are discarded
    And unchanged topics can finish their generation and delivery

  Scenario: Intent changes receive a concise confirmed acknowledgement
    Given the owner asks to save, edit, or pause an Intent
    When the Intent tool returns the saved entry
    Then the assistant confirms the actual result in one or two short sentences
    And the confirmation names the goal, condition or window, and local conversation destination
    And tool identifiers and internal revisions stay out of the reply
    When the tool fails or its result is uncertain
    Then the assistant reports the unconfirmed result and checks saved Intents before another write

  Scenario: A saved routine separates its trigger, condition and suggestion
    Given the owner asks to save a timed or context-based Intent
    When the Intent store writes the routine
    Then a YAML reader can read When, If, Then and the original request from ROUTINE.yaml
    And the record keeps Memory references by key
    And the Then section can specify only a suggestion

  Scenario: An edit upgrades saved Intent records to the routine document
    Given a previous JSON or Markdown routine document holds enabled and paused records
    When the owner saves a change
    Then ROUTINE.yaml retains each existing identity and pause state
    And only the changed record advances its revision
    And subsequent reads use ROUTINE.yaml
    And the Gmail schedule and source binding keep their existing checkpoint

  Scenario: Discuss an idea and pin it for a later recommendation
    Given the owner discusses an idea in Personal Agent
    Then the discussion creates no routine
    When the owner explicitly pins the idea with a future time and a Weather Widget condition
    Then ROUTINE.yaml stores the time, selected field, and suggestion
    And no suggestion appears before the time
    When the scheduled check reads matching live weather
    Then the Personal Agent model generates one read-only recommendation in the conversation

  Scenario: Apply the same interval trigger to a Widget observation
    Given the owner selects an Open DeskOS Data field and an interval window
    When the owner saves the routine
    Then ROUTINE.yaml stores the schedule separately from its typed input
    And the Watch checks at most once in each slot before a match
    And a data push does not start an extra check between slots
    And the first match produces one suggestion for the local day

  Scenario: A conversational Intent uses selected Widget data
    Given the owner saves a read-only Intent about a Widget measurement
    And the Intent names an existing reading and one of its fields
    When the Watch evaluates the newly saved Intent
    And the selected field is fresh and the condition is satisfied
    Then the Watch offers a read-only suggestion with the actual field and measurement time
    And the generator receives only the selected field from that reading
    And no action or ride lookup runs

  Scenario: A generic Intent card stays in the local conversation list
    Given a read-only Intent suggestion contains a selected Widget reading
    When the owner asks for suggestions in chat or a tool reads proposals
    Then the reply omits the suggestion and its measured value
    And the response tool refuses to handle that suggestion
    And ordinary suggestions and synthetic ride previews remain available

  Scenario: A generic Intent publishes only bounded cited evidence
    Given a generic Intent selects more than eight valid fields
    When the generator cites a subset in a suggestion
    Then the suggestion retains only the cited evidence
    And uncited measurements cannot support the displayed numbers

  Scenario: A selected source update only evaluates its dependent generic Intents
    Given two generic Intents depend on different readings
    When the Watch receives a change for one reading
    Then it does not read or claim the unrelated Intent

  Scenario: An offered generic Intent expires at the source measurement deadline
    Given a generic Intent card uses a fresh desk measurement
    When the measurement expires before the next heartbeat
    Then the Watch publishes its expired status without a source push

  Scenario: A Widget field cannot support an Intent when it is unavailable
    Given an Intent selects a specific field in a Widget reading
    When the reading is stale or the selected field is missing
    Then the occurrence is unknown and no suggestion is offered
    And a new Intent cannot bind an unverified reading field

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

  Scenario: The proactive evidence gates do not depend on a classifier
    Given the Jev classifier is unavailable for the resident runtime
    When the Watch generates and validates a batch of candidates
    Then only structurally valid candidates with bound facts become proposals
    And intent routing and Overview keep their separate Jev-enabled clients
    And malformed generation cannot grant action permission

  Scenario: First startup keeps bound source facts visible when synthesis fails
    Given current declared Home sources have exact supported template variables
    And no earlier briefing exists
    When the generation service fails
    Then validated source-bound facts remain visible with an error state
    And no invented values or successful model summary are reported

  Scenario: First startup shows bound facts before synthesis finishes
    Given no earlier briefing exists and current Home facts pass the original binding validator
    When the generation service is still pending
    Then the loading briefing already shows those exact source facts
    And generatedAt remains zero until a model summary succeeds
    And source changes are checked again before the generated template is accepted
    And oversized or unsupported facts do not bypass the existing required source budget

  Scenario: A recovered model template replaces the source-only presentation state
    Given a cached model template becomes applicable after source-only facts were shown
    When that template is resolved against current sources
    Then it becomes the model briefing rather than a source-only fallback
    And a later generation failure retains its complete items as stale

  Scenario: Overview selection compiles source-bound facts without copying reference syntax
    Given the host supplies a finite catalog of declared Home sources
    When the model selects source indices and their grouping
    Then the host compiles the captured catalog into the existing bound template
    And only current declared source values supply text, icons, and measurement units
    And duplicate, unknown, or stale selections cannot bind another source
    And up to sixteen required sources fit within two items without raising the existing per-item bounds
    And required coverage, output budgets, and late source changes retain their existing guards
    And generatedAt becomes nonzero only after an actual model selection succeeds

  Scenario: Compiled Overview facts keep their icon attached to their own label
    Given the model selects several source-bound facts in one item
    When the unchanged Shell groups each fact icon with its first label token
    Then every fact starts with its own label rather than a separator
    And separators remain after the preceding fact without increasing segment or source limits

  Scenario: Offline replay measures deterministic lifecycle behavior
    Given synthetic observations and fixed local generation fixtures
    When replay covers silence, repeated observations, completion, restart, snooze, quiet hours, busy state, and stale data
    Then every scenario reports its expected lifecycle outcome and generation call counts
    And the report records zero actions and no real model quality or calibration claim

  Scenario: Ending ordinary conversation preserves automatic attention policy
    Given generated suggestions are deferred while the owner is busy
    When ordinary conversation ends during quiet hours or an attention cooldown
    Then automatic presentation remains deferred
    And an explicit suggestions query retains its separate interaction behavior

  Scenario: Failed read-only feedback preserves committed state
    Given a visible read-only suggestion is pending
    When its feedback checkpoint cannot be saved
    Then the response fails and the suggestion keeps its previous state
    And no handled receipt, completion claim, or action is published

  Scenario: Legacy processed history retains its original capacity policy
    Given an old checkpoint contains processed history without occurrence identities
    When a supported new need enters the full store
    Then old processed history can release capacity under its original policy
    And unknown or executing records remain protected

  Scenario: A ready Shell recovers an offer that was not presented
    Given the resident offered a current suggestion before the Shell subscribed
    When the visible Shell announces a new consumer readiness episode
    Then Watch recovers the same suggestion without generation
    And readiness does not acknowledge presentation
    And quiet, busy, routine, snooze and dismissal policies remain effective
    And diagnostic status queries do not request recovery

  Scenario: Generated advice leads with one concise recommendation
    Given the topic includes detailed observations and an approved next action
    When ordinary generation or schema correction requests a suggestion
    Then advice requests one short sentence focused on what the owner should do
    And detailed source values and itemized quotes remain available in the cited observations
    And existing stored advice retains its original length and evidence validation

  Scenario: Feedback updates scoped recommendation memory in the background
    Given a current recommendation has an executable action or a read-only preview
    When the owner marks it useful, irrelevant, incorrect, postponed, or dismissed
    Then its feedback and pending memory work are saved together before the response returns
    And the background worker records the exact scoped feedback in Mem0
    And future generation receives that topic's learned feedback without new action permission
    And explicitly saved personal facts remain unchanged

  Scenario: Feedback learning retains lifecycle and replacement boundaries
    Given feedback learning is pending or running
    When newer feedback replaces it, its topic changes, or the Watch stops
    Then the obsolete result cannot update related memory
    And restarting can resume saved feedback work without executing a proposal action
    And an unavailable learning runtime preserves feedback without claiming memory was updated

  Scenario: Learning recovery does not erase accepted feedback work
    Given feedback is saved while Mem0 is unavailable or its first attempt fails
    When the Mem0 worker returns after restart
    Then its saved feedback work can resume within two worker attempts
    And the same explicit feedback can retry a failed attempt without reopening the handled occurrence
    And proposal-history eviction retains every unfinished learning job and its source policy
    And full learning capacity reports backpressure instead of silently discarding accepted work
  Scenario: Generation receives no host authorization bindings
    Given a generation round contains private source and action bindings
    When the host builds the model input
    Then the model receives advice material, cited evidence, goals, and timing
    And the model does not receive source snapshots, action parameters, confirmations, or rule versions
    And the host retains its complete candidate for publication and execution checks

  Scenario: Connector completion acceptance uses the current native Pi interface
    Given the connector completion fixture supplies a credential-free native Pi model resolver
    When the actual Pi 1.4 Durable harness executes its owner-input and completion cases
    Then the resolver implements getAuth without reading or supplying credentials
    And the original execution counts, authority fences, and final publication assertions remain unchanged

  Scenario: Feedback follows a completed recommendation action
    Given a recommendation action has completed with a saved receipt
    When the owner marks the completed recommendation useful, irrelevant, or incorrect
    Then feedback is saved before asynchronous learning starts
    And the completed action, receipt, handled occurrence, and owner configuration stay unchanged
    And repeated feedback does not repeat learning or execute the action
    And failed learning can retry without reopening the completed action

  # --- OpenUI integration -------------------------------------------------
  Scenario: The output contract comes from the OpenUI component library
    Given the host owns a library of generic UI primitives
    When it builds a generation session
    Then the system prompt is generated from that library, not written by hand
    And the prompt lists only the registered primitives and their typed props
    And the host authority rules stay outside the generated prompt

  Scenario: The model emits OpenUI Lang and the host parses it
    Given the generation session uses the OpenUI Lang contract
    When the Agent returns a streamed OpenUI Lang document
    Then the host parses it with the OpenUI parser before validation
    And an unparsable document is corrected once against the same contract
    And a parsed document maps to the generic preview primitives only

  Scenario: Replacing the generation contract preserves host authority
    Given OpenUI owns prompt generation, output syntax and parsing
    When a candidate reaches validation
    Then the host binds approved actions, evidence, visible facts and freshness
    And no generated UI component can grant execution permission

  Scenario: A malformed OpenUI document cannot reach the renderer
    Given the parser rejects an unknown component or a dangling reference
    When generation returns that document
    Then the round produces no candidate and leaves other topics usable
    And the renderer receives no unvalidated structure

  # --- OpenUI full replacement (pipeline contract) ------------------------
  Scenario: The full parsed component tree reaches the renderer
    Given the parser returns a ui tree holding every emitted component node
    When the host admits a candidate and publishes it
    Then the proposal carries the full ui tree over IPC
    And the renderer receives the tree without projection or node loss
    And no generation code rebuilds the tree into preview items

  Scenario: An unknown primitive is not dropped by the renderer
    Given a published ui tree holds a type outside the renderer vocabulary
    When the renderer mounts that tree
    Then the unknown type renders as plain text
    And every other component node still reaches the shared DOM
    And the unknown node never disappears silently

  Scenario: OpenUI needs no React runtime or remote asset
    Given the Shell is a framework-free DOM renderer with a strict CSP
    When the renderer builds the generic OpenUI structure
    Then each type maps to an existing shared primitive class
    And no React runtime, inline style, inline script or remote asset loads
    And every text value is written with textContent

  Scenario: Host authority survives the OpenUI contract
    Given OpenUI owns prompt generation, wire syntax, parsing and component structure
    When the host validates a returned candidate
    Then it binds approved actions, evidence, visible facts and freshness
    And no generated component grants execution permission or invents a fact
    And the host independently validates every candidate

  Scenario: An observation can contain words from its action label
    Given the advice reports a source request that contains words from the approved action label
    When the host validates the generated card
    Then the card retains its advice and one approved action
    And advice that only repeats the action label is refused

  Scenario: A composed card keeps its own structure and honest numbers
    Given a generated candidate carries advice and a freely composed OpenUI tree
    When the host validates that candidate before publication
    Then a prose node that contains the complete advice is refused
    And a concise heading or badge can use words from the advice
    And a repeated reading or metric pair is refused
    And every number the owner can see resolves to a host-issued observation value
    And headings, prose, badges, stacks and option sets remain available to the model

  Scenario: A read-only Intent uses the matching OpenUI next step
    Given a topic has intentPreview enabled and a current owner condition
    When the model reads the OpenUI generation contract
    Then the contract requires one OwnerStep for that topic
    And the contract forbids ApprovedAction for that topic
    And an ordinary topic selects one approved action identifier
    And condition thresholds do not become measured facts
    And a generic read-only example demonstrates the complete format

  Scenario: The shipped examples show visibly different generic compositions
    Given the generation contract supplies several example documents
    When the host parses those examples
    Then each example cites host-issued evidence and an approved action or read-only owner step
    And no two examples use the same component shape
    And the host rules ask for varied compositions rather than one fixed form

  # --- Model owns composition, host owns facts ------------------------------
  Scenario: The proactive chain has no judgment stage
    Given the resident starts the proactive suggestion chain
    When it builds the generation session and the host validator
    Then neither path constructs a judgment client for proposals
    And the Jev selection only governs intent routing and Overview
    And stored proposals with an older judgment record still load

  Scenario: Host validation binds measured values
    Given a generated candidate carries advice, a next step and a composed UI tree
    When the host validates the candidate
    Then the generation prompt alone decides whether a need is worth mentioning now
    And the host binds every visible number and timestamp to an approved observation
    And semantic claims are constrained by generation rules, not by a score
    And no probability or score stands between a valid candidate and the owner

  Scenario: The host binds measured card values mechanically
    Given the model composes a tree with headings, badges, stacks and readings
    When the host validates that tree
    Then every number in advice, headings, prose, badges, labels, values and options resolves to a host-issued observation value
    And a number no observation supplies is refused
    And measured card values are bound mechanically
    And the model remains free to choose order, nesting and prose

  Scenario: The host restores an unambiguous measurement unit
    Given a Reading or Metric shows only a number
    When every cited observation that supplies that number agrees on its unit
    Then the card shows the number with that unit
    And a number with an ambiguous unit stays unchanged

  Scenario: A measured value cannot borrow another observation's unit
    Given the cited temperature is 20 degrees Celsius and the humidity is 60 percent
    When the model displays 60 degrees Celsius as a Reading
    Then the host rejects the suggestion

  Scenario: The model composes varied generic trees
    Given the generation contract supplies several example documents
    When the model writes suggestions for different topics
    Then the examples show distinct compositions of the shared primitives
    And no rule caps the card at one sentence plus a flat chip list
    And every example still cites host-issued evidence and an approved action

  Scenario: Each shared primitive has a distinct rendered shape
    Given a composed tree holds Heading, Text, Badge, Reading, Metric, Stack, Row and Divider
    When the Shell renders that tree
    Then each primitive produces its own DOM class and visual treatment
    And Reading and Metric no longer share one identical chip
    And every visible text keeps the single 17-pixel reading size
    And the tree still renders exactly one card surface without concentric frames

  # --- Default startup policy ---------------------------------------------
  Scenario: A default resident starts the Watch without owner-specific configuration
    Given an operator configures no proactive environment value
    And the selected Intent and private recommendation profiles are absent
    When the resident selects its startup components
    Then the Watch is an active component and its factory is registered
    And the default owner configuration uses the 30-minute heartbeat
    And the Watch publishes valid candidates without a judgment stage

  Scenario: A classifier-disabled resident still starts the Watch
    Given the operator sets ODK_JEV_PROVIDER to disabled
    When the resident selects its startup components
    Then the Watch is an active component and its factory is registered
    And intent routing and Overview use their ordinary-model fallback
    And no proposal relevance or factual-support judgment is constructed

  Scenario: An owner configuration file keeps its explicit heartbeat
    Given the operator selects ODK_PROACTIVE_CONFIG with an explicit pollMs
    When the resident resolves the default owner configuration
    Then the configured pollMs overrides the 30-minute default
    And an explicit owner save writer remains available

  Scenario: A classifier-disabled resident keeps every resident component
    Given the operator sets ODK_JEV_PROVIDER to disabled
    When the resident starts ordinary voice, the Home Briefing and the Watch
    Then all three remain enabled
    And a configured Intent condition uses the ordinary-model judgment fallback
    And no proposal classifier request starts

  Scenario: Read-only Widget Intent model work uses a bounded response budget
    Given the selected model serves a Widget Intent through the ordinary judgment fallback
    When the resident verifies the owner's request, checks its condition, and generates the suggestion
    Then it uses the selected model for each step with a bounded response budget
    And it requests direct answers from a configured transport that otherwise enables reasoning
    And the interactive owner turn retains its configured model settings
    And the resident still checks authorization, source freshness, and cited evidence

  Scenario: Everyday Intent suggestions use calm and useful copy
    Given current observations satisfy an ordinary owner preference
    When the model proposes a read-only suggestion
    Then the advice relates the observed situation to the owner's next step
    And routine preferences use a neutral tone
    And warnings require cited urgency or risk

  Scenario: Recommendation modules have one subsystem boundary
    Given the resident composes the recommendation subsystem through its public entry
    When the resident creates the Watch, Intent runtime, and configured sources
    Then recommendation modules resolve within one recommendations directory
    And the public entry declares each exported symbol explicitly
    And shared host imports use only the reviewed private-file, model-validation, preview, and catalog peers
    And Pi Durable model execution remains in the resident adapters
    And existing owner configuration and persisted state keep their paths and formats

  Scenario: Check new labeled mail on a weekday schedule
    Given the owner saved an enabled weekday routine for a Gmail label
    When a scheduled check finds new mail with that label
    Then the Personal Agent shows one suggestion with one next step for each mail that needs action
    And it skips informational mail, older mail, and mail outside the label
    And later checks and restarts do not repeat a suggestion for the same mail
    And the routine makes no scheduled Gmail checks outside the window or while paused

  Scenario: A Routine reads its selected named notes only
    Given the owner keeps preferences in private MEMORY.md and notes in Mem0
    And a saved Routine names the notes it needs
    When Watch checks the Routine
    Then the condition receives only the named notes selected by the Routine
    And changing a selected note invalidates an older result
    And the owner can save and run a Routine without note references when Mem0 is unavailable

  Scenario: OpenUI receives the result of the Routine condition check
    Given Watch verified a Routine condition with a named note and current weather
    When Watch sends the qualified topic to the generation model
    Then the topic reports that the condition passed
    And it supplies the selected weather observation for factual claims
    And the named note and condition text stay with the host
    And the recommendation has one read-only next step
