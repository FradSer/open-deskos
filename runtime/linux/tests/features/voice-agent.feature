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
    Then a separate stable voice status instrument displays a stage label, short title, and supporting detail
    And recording feedback states the 30 second automatic stop limit without inventing elapsed time
    And processing feedback shows an explicit progress treatment without fabricating completion percentage
    And state updates reuse the same bounded surface without rebuilding its contents
    And the Pi Sessions app remains a monitor
    And voice feedback never intercepts touch navigation
    And reduced motion removes spatial movement and looping animation without removing state feedback

  Scenario: Voice feedback distinguishes outcomes without color alone
    Given the voice service publishes unavailable, error, or completion state
    When the shell receives the status
    Then the instrument uses persistent stage text and a state symbol
    And the recovery copy names the next action when voice is unavailable or fails
