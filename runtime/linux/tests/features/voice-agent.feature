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

  Scenario: The shell displays recording and execution feedback
    Given the voice service publishes recording or thinking state
    When the shell receives the status
    Then a separate voice status surface displays the state
    And the Pi Sessions app remains a monitor
    And voice feedback never intercepts touch navigation
