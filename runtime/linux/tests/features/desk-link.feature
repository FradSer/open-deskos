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
