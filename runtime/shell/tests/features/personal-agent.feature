Feature: Independent resident Personal Agent
  # The resident owns recommendation identity, freshness, feedback, and action authority.
  # The conversation owns recommendation messages and their controls.
  # The composer retains its voice and keyboard input behavior.
  Scenario: Recommendations appear as Personal Agent messages
    Given a pending recommendation arrives while the owner types a draft
    When the Personal Agent receives the current proposal snapshot
    Then the recommendation and its controls appear in one Personal Agent message
    And the message belongs to the conversation scroll view
    And no recommendation control appears in the composer
    And no recommendation popup opens or takes focus
    And the draft, input mode, and selection remain unchanged
    And Sources and details, technical receipts, and Why are absent

  Scenario: Recommendation messages preserve conversation position
    Given the owner reads earlier conversation messages above the latest message
    When a new recommendation arrives or its status changes
    Then the current conversation position and focus remain unchanged
    And Jump to latest remains available
    When the owner returns to the latest messages
    Then the recommendation is visible and the capsule names any outcome that needs the owner's attention

  Scenario: Recommendation messages retain identity and outcomes
    Given a recommendation is visible in the conversation
    When its presentation receipt, feedback, or execution state changes
    Then the same message retains its position among the conversation messages
    And its feedback, execution state, and result stay inside that message
    And an unknown execution outcome cannot be repeated

  Scenario: The latest overlay never covers recommendation controls
    Given a recommendation message shows actions near the end of the conversation
    When the owner scrolls earlier messages and the latest overlay appears
    Then the overlay keeps its position and stays out of the conversation flow
    And the message padding keeps the last controls clear of the overlay
    When the owner returns to the latest message
    Then the overlay disappears and the padding returns to the base inset

  Scenario: Agent surfaces are geometrically concentric
    Given a recommendation message renders inside the conversation
    When the owner inspects the message bubble, its nested card, and the inset panel
    Then each inner radius equals its container radius minus the padding between them
    And a chip inside the card matches the inset radius
    And a field control matches its inset panel
    And an action button shares the card radius with the card it sits beside
    And no Agent surface falls back to an unrelated fixed or pill radius
    And the Pixel theme collapses every level of that scale to zero

  Scenario: Every nested surface is concentric and shares one spacing rhythm
    Given a recommendation message shows a preview card, chips and controls
    When the owner inspects the bubble, card, chips and nearby buttons across themes and compact sizes
    Then the card padding equals the card radius token on all four sides
    And sibling surfaces at the same nesting level share one radius
    And chips and inset panels share the inset radius
    And block gaps, inline gaps and chip gaps come from one named spacing scale
    And text line height is uniform across the advice, card summary and chips
    And no surface overflows the bubble or clips its text

  Scenario: A recommendation with a session source keeps one concentric footer
    Given a status frame supplies a recommendation and one session source
    When the Shell renders the recommendation message across all themes
    Then the host appends one session footer row at the bottom of the message capsule
    And the footer shows the session source on the left and a Reply control on the right
    And the Reply control shares the card radius with the action button and the card
    And the footer uses the recommendation's one reading size
    And the bubble keeps its surface padding on all four sides
    And the footer spacing comes from the named block gap
    And the icon and source text keep one horizontal centre line
    And the source group takes a small optical nudge below the Reply centre
    And the source row grows its left inset to match the larger gap below its small text
    And the source keeps its full touch target without moving the Reply control
    And the Pixel theme collapses the whole scale to zero
    And a plain conversation message without a generated card keeps the same footer geometry

  Scenario: A message without a generated card shares the recommendation footer
    Given a status frame supplies a plain remote message and a recommendation with a card
    When the Shell renders both messages across all themes
    Then both session footers use the one reading size and the named block gap
    And both source rows carry the same left inset and optical nudge
    And both Reply controls share the card radius and keep their full touch target
    And neither footer depends on the presence of a generated card
    And the two footer groups stay on one horizontal centre line

  Scenario: Card text keeps a readable hierarchy and intact pairs
    Given a recommendation message shows advice, a preview summary and attribute chips
    When the owner reads the card across themes and compact widths
    Then the advice leads by weight and the preview summary stays a supporting label
    And a chip keeps its label and value on one line with a readable gap
    And no chip label or value wraps, clips or overflows its card
    And the card text uses one reading size from the shared scale

  Scenario: An OpenUI message states its advice once and nests one card
    Given a recommendation message renders a composed OpenUI tree
    When the owner reads the bubble
    Then the advice sentence appears exactly once in the bubble
    And the preview has one card surface, not a card inside another card
    And every reading is still visible with its label and value
    And the mounted DOM harness counts the whole sentence once across the bubble
    And a restated sentence in a card Heading is refused before publication

  Scenario: Generated advice and conversation messages render safe Markdown
    Given a recommendation advice and a remote conversation message contain strong text and a code span
    When the Shell renders the recommendation and the plain-text conversation message
    Then both render their semantic Markdown through the maintained safe renderer
    And the advice keeps its single reading size and visual priority
    And raw HTML stays literal and links stay inert text with readable URLs
    And plain messages with no Markdown keep their exact original text
    And the same rendering holds across Instrument, Pixel, Border Beam and Liquid Glass themes

  Scenario: A conversation message without a generated card stays visually consistent
    Given a remote conversation message shows owner text with a session source footer
    When the Shell renders it beside a recommendation that has a generated card
    Then the plain message keeps its text-and-footer surface without a fabricated card
    And its bubble padding, reading size and footer match the recommendation bubble
    And its text renders through the same safe Markdown as generated advice
    And the two messages share one spacing rhythm in the conversation

  Scenario: The generated card owns one spacing rhythm and no orphan divider
    Given a recommendation card composes a badge, a divider, a heading, prose and a stack
    When the Shell renders the card across themes and compact widths
    Then divider spacing comes only from the card's named block gap
    And a divider carries no extra margin that doubles the surrounding space
    And a trailing divider inside a stack draws no orphan line near the card edge
    And every gap between adjacent primitives follows the same named scale

  Scenario: One message bubble uses one reading size for its text and card
    Given a recommendation message shows advice above a generic preview card
    When the owner reads the message and its card
    Then every visible text in the bubble uses the 17-pixel reading size
    And no element falls back to a smaller caption size inside the bubble
    And the advice keeps visual priority through weight where the theme permits synthetic weight
    And the Pixel theme keeps its single weight hierarchy through order and colour instead
    And no text or chip overflows the bubble or the card
    And the same reading size holds across Instrument, Pixel, Border Beam and Liquid Glass themes

  Scenario: A recommendation message omits state and metadata text
    Given a recommendation has a preview and an executable action
    When the message renders in any proposal state
    Then the bubble shows only the advice, readings, next step and action controls
    And no status label, capability note, safety notice or result caption appears in the bubble
    When the recommendation reaches an authoritative, uncertain, read-only or expired outcome
    Then the capsule state names that outcome and carries its safety assertion
    And the capsule keeps its accessible name and bounded one-line geometry

  Scenario: Changed readings carry an optional state tone
    Given a preview reading reports a change away from its expected state
    When the recommendation message renders that reading
    Then the reading keeps its label and value as text
    And the value may carry the warn or good state tone
    And a reading without a tone keeps the neutral value color

  Scenario: Queued recommendations do not appear before their offer
    Given a pending recommendation has not been offered by the resident
    When the Personal Agent receives its proposal snapshot
    Then the recommendation does not appear in the conversation
    When the resident offers it
    Then its message appears without taking focus
    And only its visible advice can receive a presentation acknowledgement

  Scenario: Recommendation messages offer no rating controls
    Given a current recommendation message is visible in the conversation
    When the owner inspects its controls
    Then it offers only its authorized action and Later
    And no Useful, Not relevant, Incorrect, Ignore, Never suggest, or Done control appears
    And a read-only recommendation offers only Later
    And a completed recommendation offers no control
    And no feedback label or learning status text appears in the message

  Scenario: Conversational feedback still refines recommendation memory
    Given the owner states an opinion about a displayed recommendation in a normal turn
    When the resident records that response from the conversation
    Then the resident saves the feedback without waiting for Pi inference
    And a tool-free Pi job refines only related recommendation preference memory
    And future recommendations consume the saved preference memory
    And saved personal facts and action authority remain unchanged
    And no rating control is required to produce that feedback

  Scenario: Technical historical advice stays private
    Given an earlier suggestion contains a technical hash
    When its unavailable placeholder enters the conversation viewport
    Then no Sources or Details disclosure appears
    And the hidden original advice remains unacknowledged

  Scenario: Remote microphone asks the renderer before controlling recording
    Given the CM5 Personal Agent service is connected and no interaction has been activated
    When the Remote sends mic
    Then preload delivers one argument-free MIC intent to the renderer
    And one recording toggle is sent to the resident Personal Agent service
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
    Given the Personal Agent service is unavailable
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
    Given the Personal Agent service connection is active
    When malformed or oversized status records arrive
    Then they are not displayed as valid agent state

  Scenario: Starting and stopping Personal Agent acknowledge immediately
    Given the resident Personal Agent service is connected and idle
    When MIC starts or stops a voice request
    Then the shell shows starting or sending feedback before the next service status arrives
    And the feedback distinguishes listening, transcription, Pi execution, completion, and failure with persistent text

  Scenario: The Personal Agent composer opens on voice
    Given the resident Personal Agent service is connected and the composer is idle
    When the Personal Agent page opens on a host that records voice
    Then the message field is one voice button without a text field in view
    And its accessible name states that a tap starts a voice request
    When the owner taps the voice button
    Then one recording toggle is sent to the resident Personal Agent service
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
    Given the Personal Agent service publishes recording or thinking state
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
    And the Personal Agent service publishes unavailable or error state
    When the shell receives the status
    Then the instrument uses persistent stage text and a state symbol
    And the recovery copy names the next action when voice is unavailable or fails

  Scenario: Background Personal Agent service status does not open feedback
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

  Scenario: An earlier actionless suggestion offers no rating control
    Given an earlier actionless suggestion contains concise advice and stored next-step text
    When its message renders
    Then the main content states that no executable action is available
    And the resident retains the earlier next-step text
    And no reason or Why now explanation appears
    And no Done, Useful, Not relevant, or Incorrect control appears
    And Later retains a 44-pixel touch target across themes and compact sizes

  Scenario: Android reads suggestions without acquiring response authority
    Given the desk publishes suggestions through the authenticated Personal Agent link
    When the Android host projects the status
    Then advice, the next step, source evidence, and suggestion state remain readable
    And the desk projection preserves bounded next-step text and excludes the retired reason
    And the capsule names the read-only preview instead of adding a label to the message
    And the frame explicitly declares read-only suggestion capabilities
    And the renderer shows no response, execution, or ride quote control
    And no suggestion acknowledgement or response crosses the read-only link


  Scenario: Maximum-length advice remains eligible for a visible receipt
    Given a 1000-character suggestion exceeds twice the compact scroll viewport height
    When its body fills at least half of the visible scroll viewport
    Then the offered pending suggestion can receive a visibility acknowledgement
    And showing only its heading does not acknowledge the suggestion
    And hidden and read-only surfaces still send no acknowledgement

  Scenario: Native Pi configuration belongs to the trusted Shell frame
    Given the Personal Agent service provides native Pi configuration
    When the current Shell main frame requests configuration
    Then the request uses the bounded Personal Agent configuration channel
    And a foreign frame cannot request configuration
    And Pi keeps ownership of model settings and authentication

  Scenario: Sign-in links belong to the current configuration response
    Given native Pi returns a sign-in link to the requesting Shell main frame
    When the owner selects that link
    Then only that frame can open the current credential-free HTTPS link
    And another URL or a foreign frame cannot open it
    And a newer configuration request invalidates the previous link
    And a late superseded response cannot restore the previous link

  Scenario: Renderer readiness keeps its existing frame boundary
    Given the Shell has a supported Personal Agent connection
    When its current main frame reports renderer readiness
    Then only the validated main-frame request reaches the resident
    And a foreign frame cannot report readiness
    And an older client without readiness support refuses the request

  Scenario: Recording cancellation waits for its cleanup acknowledgement
    Given the Personal Agent is recording for the current Shell
    When its trusted main frame cancels the recording
    Then one cancellation request reaches the resident
    And a foreign frame cannot cancel it
    And duplicate input stays blocked until the resident reports cleanup completion
    And an older recording snapshot cannot clear the cancellation state

  Scenario: Input delivery and recovery notices keep their own row
    Given the Personal Agent composer has a visible delivery or recovery notice
    When its combined Pi and input controls render
    Then the existing notice occupies its own row above those controls
    And the notice cannot shrink the composer, recording meter, Cancel, or fixed Send control
    And native Pi login, model, and thinking controls remain reachable when the service permits them
    And the notice retains its existing message and recovery action

  Scenario: Reopening native Pi configuration has fresh request ownership
    Given a native Pi configuration list request is still pending
    When the owner closes the form and opens another configuration mode
    Then the new mode starts its own list request
    And the old response cannot replace or block the new mode
    And a closed or released form cannot retain a secret input value

  Scenario: Authentication navigation cannot update another configuration mode
    Given the owner opens a native Pi sign-in link
    When the owner closes the form, changes its mode, or releases the page
    And the navigation request later fails or reports that it did not open
    Then the old sign-in URL cannot enter the current form status
    And the current configuration state remains unchanged
  Scenario: Recommendation cards emphasize the next action
    Given a suggestion contains concise advice and an authorized plugin action
    And its source evidence contains complete SHA256 values
    When the recommendation appears in the conversation
    Then advice has visual priority over metadata
    And the concrete execution button precedes the Later control
    And a current executable card does not repeat its button label as a separate next step
    And read-only and historical cards retain readable next-step context
    And execution and exact confirmation retain the primary action style
    And confirmation receives focus and Cancel returns focus to the execution button
    And secondary actions remain quieter without losing their touch targets
    And no Why now explanation appears
    And source values remain private in resident state

  Scenario: Technical recommendation content remains in resident state
    Given an earlier stored suggestion contains a SHA256 value in its advice
    When the Personal Agent renders recommendations
    Then it requests an updated suggestion without exposing the hash
    And no source inspection control appears
    And the resident retains the original private record

  Scenario: Native acceptance requires actual visible recommendation text
    Given a recommendation is below the conversation viewport
    When another recommendation becomes visible
    Then only the visible recommendation receives a presentation acknowledgement
    And a technical placeholder cannot acknowledge its original private text

  Scenario: A long recommendation supports keyboard navigation
    Given the focused recommendation has a scrollable text region
    When the owner presses End without a modifier key
    Then the region scrolls to the complete recommendation end
    When the owner presses Home without a modifier key
    Then the region scrolls to its start
    And text input and modified key shortcuts retain their normal behavior

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
    And the earlier text remains private in resident state
    And Done is available only as historical feedback

  Scenario: An incomplete action remains non-executable
    Given an earlier suggestion has an action but no exact confirmation
    When the card opens
    Then no executable next-step control appears
    And the resident retains the earlier action details

  Scenario: Execution receipts remain private
    Given an accepted operation has a structured execution receipt
    When the recommendation appears in the conversation
    Then the capsule names that authoritative state without a status label in the bubble
    And no technical receipt, source disclosure, or execution parameter appears
    And receipt presence does not assert completion

  Scenario: An uncertain action stays reserved across card redraw and reconnect
    Given a confirmed action has no authoritative execution outcome
    When another suggestion changes and the panel redraws
    Then the first suggestion cannot execute again
    And its uncertain-action warning remains visible
    When the service reconnects with the same pending suggestion
    Then the execution reservation and warning remain
    And no automatic response replay occurs

  Scenario: Technical tool results stay outside the recommendation message
    Given an earlier plugin returns a technical result or a bounded JSON receipt
    When the Personal Agent renders the recommendation
    Then the message shows its recorded operation status
    And the original result stays in resident state
    And natural-language results remain readable
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

  Scenario: Live ride acceptance uses the installed canonical Agent channel
    Given the live acceptance entry receives isolated fixture arguments
    When the entry loads its channel before native startup
    Then it loads the installed Personal Agent client
    And it does not start a window or connect to a service

  Scenario: A real ride recommendation opens a fresh interactive quote
    Given the resident publishes a recommendation from actual Memory and reviewed DiDi results
    When the owner selects actual returned places in the inline route chooser
    And the owner activates Get current quote
    Then the actual owner text channel reaches the Agent's ride workflow
    And a new MCP estimate appears in the rendered response and controller readback
    And a preview price does not become order confirmation
    And no order or cancellation is sent

  Scenario: A real ride recommendation records usefulness feedback before its next step
    Given the owner can read a naturally generated ride recommendation
    When the owner states in a normal turn that the recommendation is useful
    Then the authenticated channel records useful feedback for that same recommendation
    And the recommendation stays pending for its read-only next step
    And the persisted checkpoint retains the feedback after a fresh quote
    And feedback cannot create an order or authorize another operation

  Scenario: Inline recommendations use the canonical Personal Agent channel
    Given the Shell exposes the canonical Personal Agent bridge
    When the inline recommendation controller mounts without an explicit bridge
    Then readiness and proposal requests use that canonical bridge
    And a retired Personal Bot bridge cannot replace it
    And releasing the controller withdraws its readiness

  Scenario: Live ride acceptance uses the current inline route and quote controls
    Given the actual inline controller renders a pending ride preview
    And the preview has one actual pickup and one actual destination
    When the live acceptance entry checks the route and activates its visible quote action
    Then it reads the actual route summary and exact returned place handles
    And it sends one ordinary owner quote request without an obsolete details control
    And duplicate clicks, wrong routes, and missing or disabled actions cannot send another request
    And Useful feedback and independent MCP receipt checks remain separate gates

  Scenario: Completed recommendations keep their result without rating controls
    Given a completed recommendation is in the conversation
    When its message renders
    Then the recorded result stays visible
    And execution, confirmation, postponement, rating, and category controls are absent
    And the draft and the completed result remain unchanged

  Scenario: OpenUI primitives render through the shared DOM adapter
    Given a parsed OpenUI document contains text, chips, badges and buttons
    When the renderer mounts it in a recommendation message
    Then every node maps to an existing shared primitive and no domain-specific card appears
    And the concentric radius scale, one reading size and capsule state ownership are unchanged
    And no React runtime, inline style, inline script or remote asset is required

  # --- OpenUI full component tree (renderer contract) ----------------------
  Scenario: The full OpenUI component tree reaches the renderer
    Given a parsed candidate carries a ui tree with nested generic primitives
    When the host publishes the candidate to the Shell
    Then the renderer receives every component node in that ui tree
    And no node is projected into a flat preview item list
    And nested children render in the order the model emitted them

  Scenario: An unknown OpenUI primitive is rendered and never dropped
    Given a ui tree holds one type the renderer does not register
    When the renderer mounts the tree in a recommendation message
    Then the unknown type appears as a plain text node
    And its siblings and children still render
    And the tree never loses the unknown node silently

  Scenario: OpenUI rendering uses only shared DOM primitives
    Given a composable OpenUI tree holds text, badges, metrics and option selectors
    When the renderer maps each type to a concentric shared primitive class
    Then rendered text uses textContent and never innerHTML
    And no React runtime, inline style, inline script or remote asset is required
    And the concentric radius scale and one 17-pixel reading size stay unchanged

  Scenario: Host authority survives the OpenUI renderer
    Given OpenUI owns the component vocabulary and the rendered structure
    When a candidate with an approved action reaches the renderer
    Then only the host binds the approved action label and tool
    And evidence provenance, freshness and lifecycle receipts stay with the host
    And Jev still judges the candidate before publication
    And the identity capsule keeps all authoritative state

