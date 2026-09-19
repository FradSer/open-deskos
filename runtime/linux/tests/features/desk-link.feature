Feature: Package-initiated Desk Link reporting

  Scenario: The service refuses an unknown token
    Given the Desk Link Service is listening
    When a connection presents a token it does not know
    Then the connection is refused
    And no Reporting Machine is registered

  Scenario: A connection must identify itself before reporting
    Given the Desk Link Service is listening
    When a connection sends a session report without a hello
    Then the connection is refused
    And no Reporting Machine is registered

  Scenario: An accepted reporter becomes a Reporting Machine
    Given the Desk Link Service is listening
    When a reporter presents its valid token and reports a running session
    Then the machine is registered
    And the snapshot names that machine as the session's provenance

  Scenario: The service bounds what a reporter may send
    Given a reporter sends more events than the bound
    When the service reads that session's events
    Then at most the bounded number of events is kept
    And every kept event is one bounded single line

  Scenario: A reporter's session set is replaced, not merged
    Given a reporter reported two sessions
    When it reports one session on its next update
    Then only the reported session remains
    And the dropped session is not presented as current

  Scenario: Independent Pi processes on one machine do not overwrite each other
    Given two authenticated Desk Links use the same Reporting Machine identity
    And the first link reports a working session and the second reports a settled session
    When either link sends its own next snapshot
    Then both sessions remain in the runtime snapshot with their respective states
    And each session's reported events remain available

  Scenario: A reporter only replaces sessions it owns
    Given two Desk Links on one machine report different sessions
    When one link stops listing its own session
    Then that session is removed without removing the other link's session

  Scenario: A dropped reporter does not leave its working session falsely live
    Given two Desk Links on one machine report different sessions
    When one link drops unexpectedly
    Then only the remaining link's sessions are available
    And the Reporting Machine remains connected

  Scenario: In-process session state takes precedence over discovered metadata
    Given one reporter directly observes a working session
    And another reporter discovers metadata for the same identity with a newer timestamp
    When the runtime reads the session
    Then the directly observed live state and goal remain authoritative
    And discovery may take over after that direct report exits or disconnects

  Scenario: Duplicate identities tolerate malformed timestamps
    Given two links on one machine report the same session identity
    And one report contains non-numeric timestamps
    When the runtime reads the snapshot
    Then the service remains available and uses only finite numeric timestamps for freshness

  Scenario: Equal-timestamp updates follow receipt order
    Given two links on one machine report the same session at the same timestamp
    When the first link later reports a changed status at that timestamp
    Then the changed status is visible

  Scenario: Two Reporting Machines stay separate
    Given two reporters hold valid links
    When the runtime reads the snapshot
    Then every session names its own Reporting Machine
    And the machines are never merged

  Scenario: A dropped link makes its sessions unavailable
    Given a Reporting Machine reported a session
    When its Desk Link drops
    Then the machine is gone from the snapshot
    And its sessions are not presented as current

  Scenario: Complete oversized Desk Link frames are rejected before parsing
    Given a reporter sends a record beyond the 1 MiB frame budget
    When the full record or its fragments reach the service
    Then that record is rejected without changing session state
    And the next bounded record can still be read

  Scenario: A reporter's CJK session data survives split UTF-8 chunks
    Given a reporter sends CJK workspace and goal text
    When a TCP chunk splits a multi-byte character
    Then the original text is preserved in the runtime snapshot

  Scenario: The runtime reads a complete bounded machine inventory across chunks
    Given a machine reports 64 sessions with long CJK metadata
    When the runtime snapshot arrives in several network chunks
    Then all 64 session identities and their metadata remain readable
    And an oversized runtime response is rejected rather than accumulated without a bound

  Scenario: The runtime reads a fresh snapshot
    Given a Desk Link Service holds state
    When the runtime requests a snapshot
    Then the snapshot reports its own scan time
    And the source identifies the Reporting Machine

  Scenario: An unavailable Desk Link is never an empty successful scan
    Given the Desk Link Service is not running
    When the runtime requests a snapshot
    Then the result is unavailable
    And it is not an empty successful scan

  Scenario: The service listens only on the local network
    Given the Desk Link Service starts without an explicit bind address
    Then it binds a local address rather than every interface

Feature: Hosted Pi control over a separate Desk Link v2 connection

  Scenario: A reporting-only v1 link stays report-only
    Given a Reporting Machine holds only the reporting token
    When it sends a control record on its v1 reporting connection
    Then the record is refused without reaching the Pi host
    And its reported sessions remain available exactly as before

  Scenario: A Console proves its Control Credential without transmitting it
    Given a Console names its machine and Pi session identity
    When it opens a v2 control connection with the reporting token
    Then the service sends a one-time challenge
    And the Console proves the credential over `open-deskos-control-v2`, version 2, nonce, machine, and session joined by newlines
    And a captured proof cannot authenticate a second challenge

  Scenario: Records coalesced with either handshake stay readable
    Given a reporter or Console sends the next record in the same TCP chunk as its hello
    When the listener routes that connection by protocol version
    Then the record after the hello is preserved for the routed connection
    And reporting and control continue normally

  Scenario: A protocol mismatch is explicit
    Given a Console uses an unsupported control protocol version
    When it opens a control connection
    Then the service replies with the accepted protocol version
    And the refusal is distinguished from a credential failure

  Scenario: The private runtime channel retains its larger snapshot bound
    Given a valid v1 report whose workspace membership makes the runtime snapshot larger than one network record
    When the runtime reads that snapshot over its owner-only Unix socket
    Then the complete snapshot is returned within the runtime response bound

  Scenario: One-shot control requests are correlated and bounded
    Given an authenticated Console
    When it lists, launches, or reads Hosted Pi history
    Then each reply carries the request identity of its request
    And only that one request reaches the Pi host before the connection closes
    And a Pi host timeout or unavailable socket produces an explicit error

  Scenario: An attach connection routes only its Hosted Pi
    Given an authenticated Console attaches with a distinct attachment identity from a position
    When it prompts, cancels, or ends through the held connection with mutation identities
    Then each command names the attached Hosted Pi and attachment
    And host events and state are returned with their durable positions
    And a command naming another Hosted Pi or attachment is refused

  Scenario: A first Attach fences live events without implicit history
    Given an authenticated Console has never attached to a Hosted Pi
    When it attaches without an applied position
    Then the host atomically installs the subscription and returns the current boundary
    And earlier entries are available only through an explicit history request

  Scenario: Control Attribution follows the held attach connection
    Given a Console is attached to a Hosted Pi
    When the runtime reads Pi Sessions
    Then that session carries an explicit Hosted Pi marker
    And the overview header names the Console machine and session in every Session Filter
    When the control connection closes before or after Attach completes
    Then Control Attribution disappears while the Hosted Pi remains

  Scenario: Hosted Pi overlays the existing Pi Sessions source
    Given the Desk Link has no Reporting Machine
    And the local Pi source and the Pi host each have a live session
    When the runtime reads Pi Sessions
    Then both sessions appear in the existing Pi Sessions source
    And the Hosted Pi is not presented as a Reported Session

  Scenario: Hosted Pi identity wins over reporting-source collisions
    Given a Hosted Pi and a Reported Session carry the same session identity
    When the runtime reads Pi Sessions and that session's events
    Then the existing Pi Sessions source keeps the explicit Hosted Pi marker
    And the Desk Link Service reads bounded history from the Pi host
    And it does not fall back to the colliding Reported Session or an unrelated local session log

  Scenario: Concurrent Attach attempts leave exactly one Console attributed
    Given one Console Attach is still pending for a Hosted Pi
    When another Console attaches to the same Hosted Pi
    Then the newer Attach fences the pending Console
    And only the newer completed Attach receives Control Attribution
