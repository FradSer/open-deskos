Feature: Owner controlled proactive Personal Bot proposals
  Proposals are read-only agent state, never plugin instructions or authorization.

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
    Then it rereads authoritative Desk Data and asks Jev with a service-push trigger
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
    When the watch polls Desk Data
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

  Scenario: Actual weather and service observations are configured
    Given the owner enables current weather condition and current holdings fields
    When a heartbeat or those services push an update
    Then the generator receives only the selected fresh authoritative observations

  Scenario: Independent service updates do not starve unrelated suggestions
    Given several owner topics depend on different live sources
    When one source pushes while another topic is generating or being judged
    Then only candidates depending on the changed source are discarded
    And unchanged topics can finish their judgment and delivery
