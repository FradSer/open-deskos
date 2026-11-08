Feature: Voice feedback status transport
  Scenario: Child activity crosses the authenticated status channel
    Given up to four active DeskOS child tasks
    When the resident publishes their identities and execution states
    Then the Shell validates bounded names, task handles, avatar ids, and states
    And it does not expose requests, role text, memory, or responses in activity metadata
    And disconnect marks retained activity unavailable

  Scenario: Pending microphone feedback preserves current child activity
    Given the authenticated client has live child activity
    When a microphone toggle waits for its service acknowledgement
    Then the pending status retains that child activity
    And only a transport failure marks the retained activity unavailable

  Scenario: Source updates wake the generation path
    Given a Hydra message, Service Plugin snapshot or declared package publication
    When the trusted Shell commits the source update
    Then the Shell sends only changed reading identifiers through the authenticated voice channel
    And the agent rereads its selected sources before generation
    And arbitrary pushed text cannot become advice or authorization
  Scenario: Transcription and streaming response remain separate
    Given the resident Personal Agent has transcribed a spoken request
    When thinking snapshots arrive with transcript and growing response text
    Then the Shell preserves the transcript separately from the current response
    And non-string transcripts are normalized to empty text
    And displayed transcripts are bounded to 4096 characters
    And maximum escaped transcript and response fit a complete status frame
    When the next recording starts
    Then the previous transcript is cleared
  Scenario: A pending resident request reaches the Shell incrementally
    Given recording has been submitted to the resident service
    When transcription finishes but the Agent is still running
    Then the real socket publishes the input before any reply
    When the Agent produces public text before completing
    Then the Shell receives that partial reply while still thinking
    When the Agent completes
    Then the Shell retains the same input with the final reply

  Scenario: Microphone levels remain bounded and truthful
    Given the resident Personal Agent is connected
    When a recording status includes a finite input level between zero and one
    Then the Shell forwards the measured level
    When a level is missing, invalid, outside that range, or not recording
    Then the Shell resets the level to zero

  Scenario: Markdown replies cross the socket without the old short-text truncation
    Given a voice request has completed
    When a response contains up to 16384 characters including escaped control characters and CJK
    Then the Shell retains the bounded full reply for Markdown rendering
    And an oversized status frame disconnects the client without displaying its content

  Scenario: Proactive proposals share the authenticated voice status socket
    Given owner rules produced evidence-bearing read-only proposals
    When an idle status carries a proposal popup
    Then one nonmodal Personal Agent panel preserves local input and displays source measurement times
    And accept first reveals the exact confirmation phrase before a separate touch action
    And accepted, ignored and muted decisions return over the same private socket
    And a busy Spoken Turn defers presentation
    And combined proposal, transcript and response frames stay within transport bounds

  Scenario: Suggestion recovery clears only the current service error
    Given the popup displays a service suggestion error
    When a recovered status retains the same proposals and hidden count
    Then the popup removes the service error without rebuilding confirmation controls
    And a later genuine service error remains visible
    When a proposal command has an uncertain delivery failure
    Then a later service error and its recovery retain that warning and disabled confirmation controls
    When recording feedback returns to Home
    Then the resident panel owns recording feedback without a modal or inert Home

  Scenario: A ride suggestion opens actual details before a separate owner request
    Given a pending suggestion contains bounded host-issued ride preview data
    When the owner opens its ride details
    Then the view shows the actual route candidates and estimate expiry
    And opening details sends no conversation turn or order command
    And ambiguous endpoints require explicit selection before requesting a current quote
    And an expired preview cannot request a quote
    And a current quote request uses the existing owner text channel

  Scenario: A read-only recommendation exposes its verified sources
    Given a pending offered recommendation cites Gmail and Calendar
    When the owner opens its Gmail source from the conversation
    Then the trusted Shell opens the bound message in the browser
    And opening the source sends no Agent turn or action command
    And the card shows no source disclosure
    And the card offers Later and Ignore

  Scenario: A schedule conflict survives the private source and Shell lifecycle
    Given a synthetic Gmail invitation proposes a change that overlaps a busy Calendar event
    When the private connector and resident publish the recommendation to the Shell
    Then the conversation shows one read-only card
    And the resident retains both source bindings
    And Open Gmail message requests only the bound browser link
    When Gmail repeats or revises the invitation across a resident restart
    Then replay preserves one card and a changed slot receives a new identity
    When Gmail cancels the invitation
    Then the previous source cannot open from the Shell
    When the owner removes authorization
    Then the Shell removes the full card from the conversation
    And the previous source cannot open from the Shell
    When a later suggestion reaches its scheduled start
    Then the Shell withdraws its source control without another Gmail poll

  Scenario: A read-only Intent recommendation shows concise advice
    Given a recommendation comes from an owner Intent that selects a Widget reading
    When the recommendation appears in the conversation
    Then the card shows advice and a read-only next step
    And the card omits evidence disclosures and raw source identifiers
    And the card does not offer an execution or navigation action
    And Later defers this occurrence while Ignore dismisses this occurrence
    And Pause reminder disables the exact owner Intent
    And one feedback request prevents duplicate or conflicting feedback until its result
    And a confirmed Later result permits feedback after the reminder returns
    And a refusal before delivery permits the owner to retry

  Scenario: Owner-selected Intent readings remain on the resident Shell
    Given a read-only Intent recommendation cites an owner-selected Widget reading
    When the resident status reaches the remote display
    Then the remote frame omits the recommendation and its evidence
    And legacy Intent recommendations with synthetic evidence retain their existing projection

  Scenario: A remote display receives calendar-only recommendations
    Given one recommendation cites Calendar and another cites Gmail
    When the resident status reaches the remote display
    Then the calendar-only recommendation shows its source label
    And the Gmail recommendation and its message ID remain on the resident Shell

  Scenario: A prepared recommendation exposes its executable next action
    Given a pending ride preview with exactly one actual pickup and destination
    When the Personal Bot renders the recommendation card
    Then Get current quote is a primary button outside collapsed ride details
    And clicking it enters the existing Agent channel with the captured preview and place handles
    And source inspection is secondary to the executable action

  Scenario: Ambiguous ride places remain explicit before execution
    Given a pending ride preview with multiple possible pickup places
    When the user clicks Get current quote without choosing a pickup
    Then the ride details open and the missing pickup receives focus
    And no Agent turn starts until both actual places are selected

  Scenario: Long recommendation text keeps the next action nearby
    Given a recommendation with long English or CJK text
    When the recommendation card renders at a compact size
    Then its complete text remains in a named keyboard-readable scroll region
    And the user can reach the final character with keyboard input
    And its executable next action remains outside that text region

  Scenario: A quote request has an uncertain delivery outcome
    Given a prepared recommendation with actual place handles
    When the next-action request loses its delivery receipt
    Then the card shows the uncertainty outside collapsed source details
    And the submitted button remains disabled
    And the card does not claim that a quote or order completed

  Scenario: Malformed preview handles cannot become executable controls
    Given a recommendation with an invalid preview handle
    When the card renders
    Then the card offers source inspection instead of a quote or refresh action
    And no malformed handle reaches the Agent channel

  Scenario: An approved reply preparation returns a private conversation response
    Given a presented email suggestion offers one host-bound reply preparation action
    When the owner confirms that action
    Then the local Personal Agent shows the resulting unsent draft as a conversation response
    And the response remains owner-only before the source read starts
    And public conversation history and remote projections exclude that response
    And a failed, duplicate, or interrupted preparation cannot publish a late draft
