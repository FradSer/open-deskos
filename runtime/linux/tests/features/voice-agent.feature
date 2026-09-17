Feature: Independent resident voice agent
  Scenario: Remote microphone asks the renderer before controlling recording
    Given the CM5 voice service is connected and no interaction has been activated
    When the Remote sends mic
    Then preload delivers one argument-free MIC intent to the renderer
    And one recording toggle is sent to the resident voice service
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
    Given the voice service is unavailable
    When the Remote sends mic
    Then voice status is unavailable
    And reconnecting does not replay the toggle

  Scenario: Voice status is bounded and validated
    Given the voice service connection is active
    When malformed or oversized status records arrive
    Then they are not displayed as valid agent state

  Scenario: Starting and stopping Voice Agent acknowledge immediately
    Given the resident voice service is connected and idle
    When MIC starts or stops a voice request
    Then the shell shows starting or sending feedback before the next service status arrives
    And the feedback distinguishes listening, transcription, Pi execution, completion, and failure with persistent text

  Scenario: The shell displays recording and execution feedback
    Given the voice service publishes recording or thinking state
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
    And the voice service publishes unavailable or error state
    When the shell receives the status
    Then the instrument uses persistent stage text and a state symbol
    And the recovery copy names the next action when voice is unavailable or fails

  Scenario: Background voice service status does not open feedback
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
