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
    Then a separate compact voice surface displays a secondary stage label without a process headline
    And recording feedback states the 30 second automatic stop limit without inventing elapsed time
    And processing feedback shows an explicit progress treatment without fabricating completion percentage
    And state updates reuse the same bounded surface without rebuilding its contents
    And the Pi Sessions app remains a monitor
    And voice feedback leaves navigation outside its bounds usable
    And no Dismiss button occupies the feedback surface
    And Remote Back or keyboard Escape hides feedback without cancelling the request regardless of focus
    And reduced motion removes spatial movement and looping animation without removing state feedback

  Scenario: Voice feedback distinguishes outcomes without color alone
    Given a voice interaction has been activated
    And the voice service publishes unavailable, error, or completion state
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
    Then only a compact secondary processing label is shown without a large headline
    When the service returns a response
    Then the response is the primary reading and remains scrollable until dismissed
    And arrow keys inside voice feedback scroll its content without navigating the underlying page
    And repeated terminal snapshots do not reopen dismissed feedback
    And reconnecting during a dismissed request does not reopen feedback

  Scenario: Voice feedback remains keyboard accessible over an App
    Given a built-in App dialog is open
    When voice feedback is activated
    Then its scrollable content belongs to the dialog focus scope
    And Remote Back or keyboard Escape closes feedback before the underlying App
    And the next Back or Escape retains normal App navigation
    And closing the App returns the feedback to the Shell

  Scenario: Voice feedback is readable at desk distance
    Given the shell runs at the CM5 native 1920 by 1280 resolution
    When recording guidance or a response is displayed
    Then stage labels are at least 24 pixels and response text is at least 32 pixels
    And recording guidance says MIC submits the recording
    And compact windows retain at least 18 pixel guidance and scroll long results without horizontal overflow
