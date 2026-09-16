Feature: Independent resident voice agent
  Scenario: Remote microphone starts the voice service rather than a monitored session
    Given the CM5 voice service is connected
    When the Remote sends mic
    Then one recording toggle is sent to the resident voice service
    And no prompt is sent to the Pi Sessions monitor

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
    And recording feedback states the 30 second automatic stop limit without inventing elapsed time
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
    Then only the response is shown without a Complete label, outcome icon, or progress
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
    When recording guidance or a response is displayed
    Then stage labels are at least 24 pixels and response text is at least 32 pixels
    And recording guidance says MIC submits the recording
    And compact windows retain at least 18 pixel guidance and scroll long results without horizontal overflow
