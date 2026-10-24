Feature: Independent resident personal bot
  Scenario: Folded historical advice is unread until its actual text becomes visible
    Given a historical suggestion contains a technical hash
    And its original advice is inside collapsed Sources and details
    When its source-inspection placeholder becomes visible
    Then the suggestion remains unacknowledged
    When the owner expands sources and the original advice enters the viewport
    Then that suggestion identifier receives a presentation acknowledgement

  Scenario: Remote microphone asks the renderer before controlling recording
    Given the CM5 personal bot service is connected and no interaction has been activated
    When the Remote sends mic
    Then preload delivers one argument-free MIC intent to the renderer
    And one recording toggle is sent to the resident personal bot service
    And no prompt is sent to the Pi Sessions monitor

  Scenario Outline: MIC restores hidden feedback before changing recording
    Given an activated voice interaction is hidden by Back
    And its latest state is <state>
    When MIC is pressed
    Then the latest input, reply, and status become visible without a recording toggle
    And safe Markdown and the reader's scroll position are retained
    And focus moves into voice feedback while the desk becomes inert
    When MIC is pressed again with feedback visible
    Then <action>
    When Back is pressed
    Then the underlying focus is restored without cancelling the interaction

    Examples:
      | state        | action                              |
      | starting     | no recording toggle is sent         |
      | sending      | no recording toggle is sent         |
      | transcribing | no recording toggle is sent         |
      | thinking     | no recording toggle is sent         |
      | recording    | one recording submit toggle is sent |
      | idle         | one new recording toggle is sent    |
      | error        | one new recording toggle is sent    |

  Scenario: Old background outcomes are not an activated interaction
    Given no voice interaction has been activated
    And an idle or error snapshot contains an earlier result
    When MIC is pressed
    Then one recording toggle is sent instead of reopening the earlier result

  Scenario: Rapid MIC intents do not queue recording toggles
    Given a recording toggle IPC invocation has not settled
    When consecutive MIC intents arrive before or after optimistic status feedback
    Then only the first recording toggle is invoked
    And no later recording starts when that invocation settles
    When the invocation rejects
    Then a truthful recovery error is shown without an unhandled rejection
    And another explicit MIC can retry

  Scenario: Background updates retain dismissal and reader position
    Given a reader scrolls up in an active streaming reply and presses Back
    When newer thinking, completed, or failed snapshots arrive
    Then feedback remains hidden without taking focus
    When MIC restores feedback
    Then the latest snapshot is displayed at the retained reader position
    And a subsequent new recording clears the old input and reply and resets scroll

  Scenario: Missing service is truthful and never replays a microphone click
    Given the personal bot service is unavailable
    When the Remote sends mic
    Then voice status is unavailable
    And reconnecting does not replay the toggle

  Scenario: Provider withdrawal removes existing suggestions
    Given a current suggestion is visible in an existing Shell frame
    When the Personal Bot provider is disabled
    Then the frame receives unavailable status without waiting for another frame load
    And the suggestion content, controls, and visibility acknowledgements are removed
    When a replacement publishes status without suggestions
    Then the previous provider's suggestions remain absent
    When the replacement publishes a current readable suggestion
    Then that suggestion can become visible and acknowledge its own identifier
    And a late failure from the withdrawn provider does not change the replacement's feedback

  Scenario: Read capability withdrawal removes existing suggestions
    Given a current suggestion is visible
    When the provider withdraws the suggestion read capability without a proposals array
    Then the old suggestion content and controls are removed
    And no old visibility acknowledgement is sent

  Scenario: Atomic provider replacement revokes the previous suggestion view
    Given a current suggestion is visible in an existing Shell frame
    When Personal Bot is replaced without an intermediate disabled state
    And the replacement publishes legacy status without a proposals array
    Then the previous provider's view is revoked before the frame receives the replacement snapshot
    And ordinary frame readiness does not revoke the current provider
    And replacing only Remote Link does not revoke Personal Bot

  Scenario: Voice status is bounded and validated
    Given the personal bot service connection is active
    When malformed or oversized status records arrive
    Then they are not displayed as valid agent state

  Scenario: Starting and stopping Personal Bot acknowledge immediately
    Given the resident personal bot service is connected and idle
    When MIC starts or stops a voice request
    Then the shell shows starting or sending feedback before the next service status arrives
    And the feedback distinguishes listening, transcription, Pi execution, completion, and failure with persistent text

  Scenario: The Personal Agent composer opens on voice
    Given the resident personal bot service is connected and the composer is idle
    When the Personal Agent page opens on a host that records voice
    Then the message field is one voice button without a text field in view
    And its accessible name states that a tap starts a voice request
    When the owner taps the voice button
    Then one recording toggle is sent to the resident personal bot service
    When the composer is idle again and the owner taps the voice button once more
    Then the text field and the Send control replace the voice button
    And the text field takes keyboard focus
    When the owner taps the microphone beside the text field
    Then the voice button returns and the next recording toggle is sent
    And the keyboard control beside the voice button opens the same text field
    And a reply reference opens the text field

  Scenario: A host without voice input opens the composer on the keyboard
    Given a Shell Host declares that it captures no audio
    When the Personal Agent page opens
    Then the text field and the Send control are in view and the voice button is not
    And the microphone control is disabled
    And it states that microphone input is unavailable on this host

  Scenario: The shell displays recording and execution feedback
    Given the personal bot service publishes recording or thinking state
    When the shell receives the status
    Then a fullscreen voice overlay displays a secondary stage label without a process headline
    And recording shows one microphone icon and only one line saying Listening
    And a separate aria-hidden line changes length from measured microphone level with no decorative animation
    And missing microphone level renders zero length
    And level-only updates do not rewrite live announcements or response content
    And recording has no duration limit or manual-submit guidance
    And processing feedback shows an explicit progress treatment without fabricating completion percentage
    And state updates reuse the same bounded surface without rebuilding its contents
    And the Pi Sessions app remains a monitor
    And voice feedback blocks underlying keyboard, Remote, pointer and touch paging while visible
    And no Dismiss button occupies the feedback surface
    And Remote Back or keyboard Escape hides feedback without cancelling the request regardless of focus
    And reduced motion removes spatial movement and looping animation without removing state feedback

  Scenario: Voice feedback distinguishes outcomes without color alone
    Given a voice interaction has been activated
    And the personal bot service publishes unavailable or error state
    When the shell receives the status
    Then the instrument uses persistent stage text and a state symbol
    And the recovery copy names the next action when voice is unavailable or fails

  Scenario: Background personal bot service status does not open feedback
    Given no voice interaction has been activated
    When idle, unavailable, or error snapshots arrive including previous result text
    Then the voice surface remains hidden
    When MIC is pressed while the service is unavailable
    Then the shell marks the feedback as explicitly activated and shows recovery guidance

  Scenario: Results take precedence over process metadata
    Given a voice interaction is active
    When the service is thinking without response content
    Then only a secondary processing label is shown without a large headline
    When the service returns a response
    Then the recognized input and response are shown without a Complete label, outcome icon, or progress
    And the response remains vertically scrollable by keyboard, touch, wheel, and Remote up or down until dismissed
    And arrow keys inside voice feedback scroll its content without navigating the underlying page
    And Page Down and End scroll the response using real keyboard input
    And repeated terminal snapshots do not reopen dismissed feedback
    And reconnecting during a dismissed request does not reopen feedback

  Scenario: Voice feedback remains keyboard accessible over an App
    Given a built-in App dialog is open
    When voice feedback is activated
    Then focus moves into the fullscreen voice dialog and stays there with Tab or Shift Tab
    And the underlying App is inert until voice feedback closes and restores its previous focus
    And Remote Back or keyboard Escape closes feedback before the underlying App
    And the next Back or Escape retains normal App navigation
    And feedback remains a Shell-owned overlay without changing the underlying page

  Scenario: Voice feedback preserves Remote App focus mode
    Given Remote primary has entered focus mode on an App page control
    When voice feedback opens and Remote Back closes it
    Then the previously focused control is restored and the published mode is focus
    And Remote primary activates that control without re-entering focus mode

  Scenario: Voice activation interrupts an underlying swipe
    Given a page swipe has started and displaced the page track
    When voice feedback opens before the pointer is released
    Then the track returns to the current page without changing the page index
    And the viewport releases its captured pointer immediately
    And further pointer movement and release cannot navigate until feedback closes
    And Remote actions cannot activate hidden App controls
    And Remote page state disables previous and next while feedback is visible

  Scenario: Voice feedback floats above a visible but blocked desk
    Given the shell uses Instrument, Pixel, or Border Beam at 1920 by 1280, 480 by 854, or 320 by 480
    When a voice interaction starts
    Then the fullscreen input shield is transparent and consumes hits outside the panel
    And a charcoal outlined panel sits inset at the bottom center with bounded width and at most 70 percent viewport height
    And the underlying desk remains visible but inert and cannot navigate by keyboard, pointer, or Remote
    When a long English and CJK response arrives
    Then the same panel scrolls vertically without horizontal overflow
    And no Complete label or Dismiss control is shown
    When Remote Back closes voice feedback
    Then the original page and focus are restored and the desk is no longer inert

  Scenario: Voice feedback is readable at desk distance
    Given the shell runs at the CM5 native 1920 by 1280 resolution
    When Listening or a response is displayed
    Then stage labels are at least 24 pixels and response text is at least 32 pixels
    And compact windows retain at least 18 pixel stage text and 24 pixel response text and scroll long results without horizontal overflow

  Scenario: Recognized input precedes the real streaming response
    Given an activated request has completed transcription
    When thinking status supplies recognized input and accumulating assistant text
    Then plain recognized input appears beside a small neutral microphone icon before Working and progress
    And no visible You label occupies a separate row
    And the input retains a spoken-input accessible name
    And the actual partial response renders as safe Markdown below progress
    And input containing Markdown or HTML remains literal selectable text
    And no internal thinking, tool arguments, or tool results are displayed
    And the stage live region excludes input and response
    And the response is non-atomic and busy while streaming to avoid repeated whole-reply announcements
    When the request completes
    Then input and final response remain while Working and progress disappear
    And a completed turn without assistant text still retains recognized input
    And an idle shutdown without input or response hides feedback
    And a first non-streamed final reply starts at the top
    When a streaming request fails
    Then input remains with explicit recovery and the partial response is removed
    When starting, recording, or transcribing begins a new turn
    Then old input and response are cleared

  Scenario: Streaming respects readers and dismissed feedback
    Given streaming feedback is displayed in each theme at native and compact sizes
    When new response text arrives while the reader is at the bottom
    Then the panel follows the new bottom
    When the reader scrolls up and more text arrives
    Then their scroll position is preserved
    And repeated unchanged thinking and completed snapshots retain input and reply DOM without scrolling
    When feedback is dismissed during streaming
    Then partial, final, and error updates never reopen it or take focus

  Scenario: Final replies render safe readable Markdown
    Given a voice interaction is active
    When a final reply contains headings, strong and emphasized text, lists, quotes, code, and tables
    Then the reply renders their semantic Markdown structure using a maintained Markdown library
    And plain replies retain their original text
    And Markdown character references and escaped punctuation display their decoded literal text
    And links display readable inert labels and URLs and images display only their alt text
    And raw HTML and unsafe links never execute, navigate, or load network assets
    And repeated identical replies retain their DOM and scroll position
    And Instrument, Pixel, and Border Beam retain meaningful emphasis without synthesizing Pixel weights or styles
    And long English, CJK, code, and tables remain readable and bounded at native and compact sizes

  Scenario: Reply to a specific Pi session from its incoming update
    Given an incoming update contains retained references for two Pi sessions
    When the owner selects Reply for one session
    Then the composer identifies that session and the original update
    And the owner can cancel the reference without losing the draft
    When the owner submits the reply
    Then only the message ID and exact source key and revision accompany the text
    And the renderer supplies no target, project, or session authority
    And a failed or disconnected submission retains the draft and reference
    And accepted replies and later completed updates remain in the same durable session thread
    And another session requires an explicit selection
    And ordinary messages do not inherit a prior reply reference

  Scenario: Session replies remain readable and keyboard accessible
    Given a session identifier is long and the conversation contains many updates
    When the owner uses a compact window or changes the theme
    Then each incoming update shows a session identifier with its complete value available
    And Reply and Cancel reply have keyboard access and touch targets of at least 44 pixels
    And the selected thread uses the existing conversation scroll region above the fixed composer
    And returning to all messages retains the original updates

  Scenario: A previous host cannot silently drop a session reference
    Given the host bridge accepts only ordinary text or the service does not advertise reply input
    When an incoming Pi update is displayed
    Then a session reply cannot be dispatched as an ordinary owner message
    And ordinary text remains available without a reply reference

  Scenario: A canonical thread projection replaces the reported thread in place
    Given an existing update has a selected reported Pi session thread
    When the same message and source revision receive a canonical thread projection
    Then the existing message remains one article with its original reply reference
    And its session action and selected thread use the canonical thread
    And a durable reply in that thread remains visible without a Shell restart

  Scenario: Leaving a session thread restores existing coverage notices
    Given the current remote snapshot has a stale or omitted update notice
    When the owner opens a session thread and returns to All messages or cancels a reply
    Then the existing notice is visible without another status frame
    And a complete snapshot remains free of coverage notices

  Scenario: Personal Agent readiness does not require optional Jev authentication
    Given the configured ordinary judgment service is ready
    And Jev authentication is unavailable
    When the resident status reaches the Shell
    Then Personal Agent is ready without claiming Jev authentication passed
    And malformed judgment status cannot become ready
    And an older Host without judgment status keeps its existing status contract


  Scenario: Suggestions distinguish visible content from delivery
    Given the nonmodal suggestion panel contains several offered pending suggestions
    When one suggestion enters the visible scroll viewport
    Then only that visible suggestion is acknowledged
    And hidden, unopened, unoffered, and snoozed suggestions are not acknowledged
    And unconfirmed visibility can retry with a bounded rate
    And a restored connection or recovered resident failure permits another visibility acknowledgement
    And local focus and Shell navigation remain available

  Scenario: Feedback describes the outcome of one suggestion
    Given an earlier actionless suggestion contains concise advice and stored next-step text
    When the owner opens Feedback and selects Done, Later, Useful, Not relevant, or Incorrect
    Then the response identifies only that suggestion and decision
    And Done does not execute the suggested action
    And the main content states that no executable action is available
    And Sources retains the earlier next-step text
    And no reason or Why now explanation appears
    And technical sources and previous suggestions use keyboard-accessible disclosures
    And controls retain 44-pixel touch targets across themes and compact sizes

  Scenario: Android reads suggestions without acquiring response authority
    Given the desk publishes suggestions through the authenticated Personal Agent link
    When the Android host projects the status
    Then advice, the next step, source evidence, and suggestion state remain readable
    And the desk projection preserves bounded next-step text and excludes the retired reason
    And a current next step is labelled as a read-only preview instead of an earlier suggestion
    And the frame explicitly declares read-only suggestion capabilities
    And the renderer shows no response, execution, or ride quote control
    And no suggestion acknowledgement or response crosses the read-only link


  Scenario: Maximum-length advice remains eligible for a visible receipt
    Given a 1000-character suggestion exceeds twice the compact scroll viewport height
    When its body fills at least half of the visible scroll viewport
    Then the offered pending suggestion can receive a visibility acknowledgement
    And showing only its heading does not acknowledge the suggestion
    And hidden and read-only surfaces still send no acknowledgement

  Scenario: Recommendation cards emphasize the next action
    Given a suggestion contains concise advice and an authorized plugin action
    And its source evidence contains complete SHA256 values
    When the nonmodal card opens
    Then advice has visual priority over metadata
    And the concrete execution button precedes source and feedback disclosures
    And a current executable card does not repeat its button label as a separate next step
    And read-only and historical cards retain readable next-step context
    And execution and exact confirmation retain the primary action style
    And confirmation receives focus and Cancel returns focus to the execution button
    And secondary actions remain quieter without losing their touch targets
    And source and feedback disclosures are closed by default
    And no Why now explanation appears
    And source values remain complete when the owner opens Sources

  Scenario: Earlier technical suggestions retain their complete content
    Given an earlier stored suggestion contains a SHA256 value in its advice
    And it has no next step
    When the card opens
    Then the main content asks the owner to review the earlier suggestion in Sources
    And View sources opens the complete original advice without executing an action
    And opening Sources alone does not acknowledge the suggestion
    And the original advice remains the visibility observation target

  Scenario: Native acceptance waits for the actual visibility receipt
    Given an earlier technical suggestion is inside collapsed Sources
    When its original advice becomes visible after the owner opens Sources
    Then acceptance waits for the same suggestion visibility command after fonts and frames settle
    And an unrelated suggestion receipt cannot satisfy the wait
    And a missing or late receipt fails within the bounded wait
    And the original overall acceptance deadline remains unchanged

  Scenario: The next step starts an authorized plugin operation
    Given a pending suggestion has an owner-authorized action and exact confirmation
    When the owner selects its concrete next-step button
    Then the card requests a separate exact confirmation without executing yet
    When the owner confirms twice before the host replies
    Then only one proposal acceptance reaches the plugin
    And completion appears only after the host reports completion
    And executing and uncertain outcomes offer no repeat execution

  Scenario: Earlier suggestions cannot imply executable authority
    Given an earlier suggestion has text for a next step but no authorized action
    When the card opens
    Then it states that no executable action is available
    And the earlier text remains available in Sources
    And Done is available only as historical feedback

  Scenario: An incomplete action remains non-executable
    Given an earlier suggestion has an action but no exact confirmation
    When the card opens
    Then no executable next-step control appears
    And Sources retains the earlier action details

  Scenario: Execution receipts remain inspectable in Sources
    Given an accepted operation has a structured execution receipt
    When the suggestion card opens
    Then Sources keeps the receipt closed by default
    And the main card does not expose technical receipt fields
    When the owner opens Sources
    Then the complete bounded receipt is readable as text
    And receipt presence does not change the authoritative suggestion state

  Scenario: An uncertain action stays reserved across card redraw and reconnect
    Given a confirmed action has no authoritative execution outcome
    When another suggestion changes and the panel redraws
    Then the first suggestion cannot execute again
    And its uncertain-action warning remains visible
    When the service reconnects with the same pending suggestion
    Then the execution reservation and warning remain
    And no automatic response replay occurs

  Scenario: Earlier tool results keep technical details in Sources
    Given an earlier plugin returns a technical result or a bounded JSON receipt
    When the recommendation card opens
    Then Sources keeps the complete original result as collapsed text
    And natural-language results remain in the main card
    And the result never replaces the authoritative proposal state

  Scenario: Stable action confirmation survives unrelated status updates
    Given the owner opens the exact confirmation for a pending action
    When its visibility receipt or another suggestion changes the panel
    Then the same authorized confirmation remains available
    And repeated activation sends at most one acceptance

  Scenario: A superseded confirmation cannot authorize an old action
    Given the owner opens an exact action confirmation
    When its action or confirmation changes, its proposal ends, or response capability is withdrawn
    Then the earlier confirmation cannot send an acceptance
    And a detached control cannot regain execution authority

  Scenario: A real ride recommendation opens a fresh interactive quote
    Given the resident publishes a recommendation from actual Memory and reviewed DiDi results
    When the owner opens ride details and selects actual returned places
    And the owner activates Get current quote
    Then the actual owner text channel reaches the Agent's ride workflow
    And a new MCP estimate appears in the rendered response and controller readback
    And a preview price does not become order confirmation
    And no order or cancellation is sent

  Scenario: A real ride recommendation records usefulness feedback before its next step
    Given the owner can read a naturally generated ride recommendation
    When the owner opens Feedback and activates Useful
    Then the authenticated channel records useful feedback for that same recommendation
    And the recommendation stays pending for its read-only next step
    And the persisted checkpoint retains the feedback after a fresh quote
    And feedback cannot create an order or authorize another operation
