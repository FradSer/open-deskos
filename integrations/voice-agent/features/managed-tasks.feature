Feature: Durable per-host Hosted Pi sessions
  Scenario: Receipt survives client disconnect and identical retries
    Given a configured development root and private session store
    When a start request is accepted and its client disconnects
    Then its receipt is durable before the coding job starts
    And an identical session ID retry returns the existing session
    And a different payload with that ID is rejected

  Scenario: Project and host concurrency are bounded
    Given four independent running projects
    When another session starts
    Then the request is rejected without running another job

  Scenario: Overlapping canonical projects cannot run together
    Given a running session and a symlink alias to its child directory
    When another session requests its parent or child through either path
    Then the request is rejected until the running session stops running
    And unrelated sibling projects may run concurrently

  Scenario: An idle unattached session releases its project
    Given a session that is alive, idle at its prompt, and attached to no Console
    When another session requests an overlapping project
    Then the request is admitted when the host-wide cap allows it
    And the idle session re-acquires the project overlap lock when it resumes

  Scenario: An abandoned session does not consume the host forever
    Given a session that stays idle and unattached beyond the idle bound
    When the bound passes
    Then the session is released without replaying its prompt
    And an operator can also end it explicitly before that
    And the host remains available for other work

  Scenario: Persisted receipts are validated before recovery
    Given persisted receipts in the private session store
    When the service restarts
    Then only complete records with valid IDs, states, not_run verification, absolute projects and ordered ISO dates are trusted
    And prompts are nonempty and at most 64 KiB of UTF-8 and responses are at most 16 KiB of UTF-8
    And records exceeding 80 KiB or containing malformed UTF-8 or invalid fields fail startup
    And malformed records are not rewritten as interrupted or presented as completed sessions
    And valid terminal states and UTF-8 text at the limits survive restart unchanged
    And all records are validated before any pending or running receipt is rewritten

  Scenario: A session persists across turns
    Given an admitted session whose first turn has settled
    When a further prompt is delivered to that same session
    Then it runs as a further turn in the same identity
    And no new receipt or identity is created

  Scenario: A further prompt steers a running turn
    Given a session whose turn is executing
    When a further prompt states a delivery behavior
    Then it steers that running turn rather than starting a second one

  Scenario: A streaming prompt requires a delivery behavior
    Given a session whose turn is executing
    When a prompt arrives without stating a delivery behavior
    Then the request is refused and the running turn is unaffected

  Scenario: Cancelling keeps the session alive
    Given a session with a durable identity
    When a running turn is cancelled
    Then the turn is aborted
    And the session is not disposed and keeps its identity
    And its receipt records a cancellation rather than a success

  Scenario: Ending disposes the session and frees its slot
    Given a session that is alive with a durable receipt
    When it is ended
    Then the session is disposed and its slot is released
    And its terminal receipt remains readable

  Scenario: Real paths restrict admission, not the coding tools
    Given configured roots and a symlink pointing outside them
    When a project outside the roots or under /opt/open-deskos is requested
    Then admission is rejected
    And the service does not claim to sandbox bash

  Scenario: Restart never replays work
    Given a durable running receipt from an earlier process
    When the service restarts
    Then the session is interrupted and the prompt is not replayed
    And its own session log remains readable for a later attach

  Scenario: Hosted Pi capability is the host's tool set
    Given an admitted session
    When its turn requests a commit, a push, an installation, a deployment, or a service restart
    Then the request is not blocked by a capability guardrail
    And the host loads no extensions, skills, or prompt templates
    And admission, the durable receipt, the cap, no automatic retry, and no replay after restart still apply

  Scenario: Completion is not verification
    Given a session whose adapter returns after the full prompt
    When its final stop reason is stop
    Then the session is finished with verification not_run
    And response text is limited to 16 KiB
    But length, error, aborted or missing stop reasons never indicate success

  Scenario: Escaped adapter text fits the complete durable receipt
    Given an accepted session with a 64000 byte ASCII prompt
    When its adapter returns 16000 newlines or escaped control text mixed with Unicode
    Then its terminal receipt including JSON escapes and metadata is at most 80 KiB
    And the response is a well-formed Unicode prefix of at most 16 KiB
    And the original prompt and terminal state survive status and restart
    And the service remains available for another session
    And admission reserves room for terminal and interruption metadata and a generic failure explanation

  Scenario: Malformed Unicode cannot poison recovery
    Given a start request containing an escaped lone surrogate in its prompt
    When admission validates the request
    Then it is rejected without creating a receipt or invoking the adapter
    And a valid session can still run and survive restart
    When a valid session adapter returns lone surrogates
    Then replacement characters normalize its response before persistence
    And its terminal response survives restart unchanged

  Scenario: Recorded sessions remain reachable after their project moves
    Given a running session whose project directory is renamed or deleted
    When status or cancellation uses its submitted or canonical project path
    Then the recorded session remains reachable without filesystem admission
    And a different project identity is rejected

  Scenario: Failed runs explain their outcome safely
    Given an adapter returning an error, length, aborted or missing stop reason with empty text
    When its outcome is recorded
    Then failed or cancelled sessions include a nonempty generic explanation
    And provider error details are not exposed

  Scenario: Cancellation propagates to the coding session
    Given a running session
    When it is cancelled
    Then the adapter receives an aborted signal
    And its project remains occupied until the adapter exits
    And its final state is cancelled

  Scenario: Private bounded request response transport
    Given a private Unix socket and short JSON stdin helper
    When a version 1 correlated request is sent
    Then it receives one bounded correlated response
    And invalid, oversized or overdue frames are rejected
    And disconnecting never cancels an accepted session

  Scenario: Malformed project text cannot poison session recovery
    Given a real project containing a replacement character
    When a start request uses a lone surrogate instead
    Then the request is rejected before receipt persistence
    And the session service can restart normally