Feature: Resident push-to-talk coding agent
  Scenario: Toggle records then submits speech once
    Given an idle resident agent and an available recorder
    When toggle starts recording and toggle stops recording
    Then status progresses through recording, transcribing, thinking and idle
    And the transcript is submitted once and temporary audio is removed
    And the final plain text agent response is published as a bounded status message

  Scenario: Busy input and failed capture
    Given transcription is in progress
    When toggle is received
    Then no second recording starts
    And a failed recorder or provider produces a safe error and permits retry
    And cleanup failure is contained without an unhandled rejection

  Scenario: Recording deadline and shutdown
    Given a recording is active
    When the maximum recording duration expires
    Then recording stops and the transcript is submitted
    When the service shuts down
    Then all recording resources are removed and no prompt starts

  Scenario: Private bounded control transport
    Given the resident service is listening on a private Unix socket
    When a client sends a version one status or toggle command
    Then it receives a version one status
    And malformed or oversized commands never start recording

  Scenario: Unconfigured service remains reachable
    Given credentials or a writable checkout are not configured
    When a status command arrives
    Then the service reports a configuration error without exiting
    And toggle does not capture audio until configuration is valid

  Scenario: Voice consumes the shared Open DeskOS workspace
    Given ODESK_WORKSPACE specifies the system writable checkout
    And transcription credentials are not configured
    When the resident service starts
    Then configuration advances to the transcription credential requirement
    And a voice-specific workspace variable is not used as a fallback

  Scenario: Bounded cloud transcription
    Given a WAV recording and a credential file
    When cloud transcription is requested
    Then multipart WAV audio is sent with bearer authentication
    And oversized audio, oversized responses and empty transcripts are rejected
    And provider errors never reveal credentials or response bodies

  Scenario: Device-local loopback transcription
    Given a device-local speech service on the loopback interface and a credential file
    When the resident service starts with its plain HTTP loopback URL
    Then the loopback URL is accepted for transcription
    And plain HTTP URLs outside loopback are rejected before any request

  Scenario: Persistent coding and extensible capabilities
    Given a configured writable checkout and trusted local capability modules
    When the resident Pi session starts
    Then it resumes its own durable session with real coding tools and the widget skill
    And live session list and send tools use the bounded session-control JSON protocol
    And coding instructions require tests before staged activation and forbid editing active releases

  Scenario: Manage resident user applications through the shell lifecycle
    Given the shell application control socket is available
    When the agent lists, installs, rolls back or removes an application by ID
    Then each lifecycle request uses the bounded version one JSONL protocol
    And install drafts follow the ODESK_WORKSPACE/apps/<id> manifest contract and are verified by the system tool
    And application UI runs in a strict scripts-only sandbox without network or parent access

  Scenario: Deliver to live sessions on the configured SSH host
    Given an operator-configured SSH host and absolute session-control executable
    When a session capability runs
    Then SSH uses batch authentication, strict host key checks and a bounded connection timeout
    And only the fixed executable is sent as the remote command with JSON on stdin
    And invalid hosts or executable paths are rejected before spawning
    And an uncertain send failure explicitly forbids automatic retry to avoid duplicate delivery
