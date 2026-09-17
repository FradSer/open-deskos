Feature: Resident push-to-talk coding agent
  Scenario: Toggle records then submits speech once
    Given an idle resident agent and an available recorder
    When toggle starts recording and toggle stops recording
    Then status progresses through recording, transcribing, thinking and idle
    And the transcript is submitted once and temporary audio is removed
    And the final Markdown agent response is published up to 16384 characters without truncating shorter replies
    And replies beyond the bound carry a visible truncation notice inside that bound
    And the Pi adapter preserves full Markdown text for the service to bound once
    And resident instructions allow Markdown replies

  Scenario: Real SDK assistant snapshots belong only to the current request
    Given a resident SDK session with old conversation history
    When a voice request receives public assistant streaming events
    Then snapshots contain accumulated visible text across its successful assistant messages separated by blank lines
    And thinking, tool arguments, tool results and old history are excluded
    And failed retry-attempt text is removed without duplicating previous successful messages
    And overflow recovery removes only its failed or truncated attempt, not earlier successful messages
    And the final response uses the same accumulated successful message text
    And a request without an assistant never falls back to an old reply
    And failed or aborted requests fail safely even when retry removes the failed message
    And the subscription is installed before prompting and removed on success or failure
    And callbacks after completion and concurrent prompts cannot expose another request

  Scenario Outline: Terminal overflow recovery never publishes a successful truncated reply
    Given a voice transcript and successful assistant narration before a length-truncated response
    And <recovery> before the terminal compaction event
    When overflow compaction ends without retry because it <outcome>
    And the SDK prompt resolves normally
    Then the adapter rejects the request and removes the truncated attempt from snapshots
    And the service reports a safe error retaining the transcript rather than an idle partial success
    And provider details, queued snapshots and late callbacks cannot replace the safe error
    And the SDK subscription is removed

    Examples:
      | recovery                                      | outcome                        |
      | no earlier overflow recovery occurred         | failed with a provider error   |
      | no earlier overflow recovery occurred         | was aborted or cancelled       |
      | one compact-and-retry produced another length | exhausted its recovery attempt |

  Scenario: A length-truncated response without recovery events is not complete
    Given a voice transcript and a length-truncated assistant response
    When the SDK cannot start overflow recovery and emits no compaction event
    And the SDK prompt resolves normally
    Then the adapter rejects the incomplete request
    And the service retains the transcript with safe error feedback

  Scenario: Successful maintenance compaction preserves a completed reply
    Given an assistant response ended successfully
    When overflow compaction succeeds without retry
    Then the completed reply remains successful

  Scenario: Transcribed input and coalesced live replies
    Given transcription has returned recognized plain text
    When the SDK prompt starts and remains pending
    Then thinking immediately publishes the transcript before prompting
    And transcript is bounded to 4096 UTF-16 code units with a visible truncation notice
    And only the display transcript is truncated, not the submitted request
    And pending visible reply snapshots are bounded to 16384 code units
    And updates coalesce to at most one per 100 milliseconds without repeating identical snapshots
    And completion immediately flushes the authoritative final reply as idle
    And main forwards the streaming callback to the SDK adapter
    And pending timers and late callbacks cannot update a finished request, new recording or shutdown
    And failures retain the transcript but replace partial output with safe recovery text
    And a new request or shutdown clears both transcript and response

  Scenario: Busy input and failed capture
    Given transcription is in progress
    When toggle is received
    Then no second recording starts
    And a failed recorder or provider produces a safe error and permits retry
    And cleanup failure is contained without an unhandled rejection

  Scenario: Unlimited listening and shutdown
    Given a recording is active without speech
    When more than 30 seconds pass
    Then recording remains active without a duration deadline
    When the service shuts down repeatedly
    Then all recording resources are removed once and no prompt starts

  Scenario: Local WebRTC speech endpoint
    Given signed 16-bit mono 16000 Hz microphone PCM is streamed to a WAV file with backpressure
    When local WebRTC VAD detects speech followed by 60 consecutive silent 20 ms frames
    Then capture stops and submits once after approximately 1.2 seconds of silence
    And silence before speech never submits
    And speech restarts the consecutive silence count
    And a manual MIC toggle still stops capture
    And stopping drains queued disk writes before finalizing the WAV header
    And the WAV header describes the final streamed audio without retaining the recording in memory

  Scenario: Measured microphone level
    Given microphone capture is active
    When five 20 ms PCM frames arrive
    Then recording status publishes measured RMS level between zero and one
    And levels reset to zero outside recording
    And late callbacks from old captures cannot update a new recording

  Scenario: Capture failures release resources
    Given capture startup, process execution or WAV writing fails
    When capture is cleaned up repeatedly or shut down
    Then the process terminates and all temporary files and VAD allocations are released once
    And no unhandled rejection occurs
    And shutdown during capture startup or stop never starts transcription

  Scenario: Real local WebRTC classifier
    Given the pinned local WebRTC WASM VAD is initialized at 16000 Hz
    When complete silent 20 ms frames are classified
    Then WebRTC returns non-speech locally without any provider
    And incomplete frames are rejected and disposal is idempotent

  Scenario: Private bounded control transport
    Given the resident service is listening on a private Unix socket
    When a client sends a version one status or toggle command
    Then it receives a version one status
    And malformed or oversized commands never start recording
    And a 131072-byte status frame budget accommodates maximally escaped 16384-character replies and 4096-character transcripts together in less than 123000 bytes

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
    And WAV uploads through 25000000 bytes are accepted even when longer than 62 seconds
    And audio above 25000000 bytes is rejected explicitly before upload
    And status explains the upload limit without exposing provider details
    And oversized responses and empty transcripts are rejected
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
