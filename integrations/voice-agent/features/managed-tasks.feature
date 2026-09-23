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

  Scenario: Session lifecycle is separate from turn outcome
    Given a live Hosted Pi whose last turn finished, failed, or was cancelled
    When its status is read
    Then its lifecycle remains live and its activity is idle
    And the last turn outcome does not dispose its identity
    But end or host-restart interruption changes the lifecycle

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

  Scenario: The audio agent controls a session that already exists
    Given a Hosted Pi recorded on a configured target with a durable task identity
    When the voice coordinator lists that target's sessions
    Then it receives that session's project, state, lifecycle, activity and goal
    And the list is ordered most recently updated first
    And a project scope is a subtree, so a configured development root lists every session under it
    When it reads that session's history
    Then it receives a bounded page of that session's own events
    And no new identity or receipt is created
    When it sends a further instruction to that idle session
    Then the instruction runs as another turn under the same identity
    But while that turn is executing the same prompt is refused without a delivery behavior
    And ending the session disposes it and releases its slot while its terminal receipt stays readable

  Scenario: Only the list resolves a session from a broader scope
    Given a Hosted Pi launched in a subproject of a configured development root
    When the list is scoped to that root
    Then the session is reported with its own project
    When an identity command reuses the root instead of that project
    Then it is refused as an unknown session
    And a different project identity is refused for the same session

  Scenario: A prompt to an ended session is refused as ended
    Given a Hosted Pi whose lifecycle is ended
    When a further prompt names that session with its own project
    Then the request is refused stating that the Hosted Pi has ended
    And it is not reported as a malformed prompt
    And no replacement session is created or started

  Scenario: A session whose launch is in flight is refused as starting
    Given an accepted Hosted Pi whose SDK session has not been built yet
    When a prompt, a history read or an attach names that session
    Then it is refused as starting rather than as ended
    And its lifecycle still reports launching
    And a session that then fails to build reports its own failure once

  Scenario: Repeating an end never rewrites a terminal receipt
    Given a Hosted Pi whose lifecycle is already ended or interrupted
    When it is ended again
    Then the request is accepted and changes nothing
    And its recorded turn outcome, state and ending reason are unchanged

  Scenario: Ending a Console-driven session clears its own record and tells that Console
    Given a Hosted Pi that a Console is driving
    When it is ended
    Then the session is disposed and its slot is released
    And that Console receives a terminal state instead of silence
    And the Hosted Pi record stops naming a Console
    And desk-visible Control Attribution still lives as long as the Console's held connection does

  Scenario: Ending a session whose launch is still in flight settles
    Given an accepted Hosted Pi whose launch has not completed
    When it is ended before its session exists
    Then the request is accepted with a terminal receipt
    And the session built afterwards is disposed rather than left running
    And a build that fails afterwards leaves that terminal receipt unchanged

  Scenario: A reported project resolves for a symlinked development root
    Given a configured target whose development root is a symlink
    When a session under it is listed and its own project is then used as the identity
    Then the project the list reported is accepted without being re-derived by the coordinator
    And a project outside that root is still refused

  Scenario: An unaddressable session is reported instead of steered
    Given a Pi session someone started in a terminal window on the host
    When the voice coordinator is asked to control it
    Then no task identity resolves to it
    And the coordinator reports it as unaddressable rather than claiming control

  Scenario: An unconfigured target list is reported instead of guessed
    Given a voice coordinator whose device-local target configuration names no target
    When a request asks to control a session on a host
    Then coding_targets lists no target
    And the coordinator reports that Hosted Pi control needs its device-local configuration
    And it does not guess a host, a project, or a root

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
    And an Attach holds a bounded JSONL connection for further correlated commands and live events
    And invalid, oversized or overdue frames are rejected
    And disconnecting never cancels an accepted session

  Scenario: Mutations reconcile by caller identity
    Given an accepted prompt, cancel, or end mutation
    When its caller repeats the same mutation identity and canonical payload
    Then the recorded result is returned without applying it twice
    But reusing that mutation identity for a different payload is refused

  Scenario: Malformed project text cannot poison session recovery
    Given a real project containing a replacement character
    When a start request uses a lone surrogate instead
    Then the request is rejected before receipt persistence
    And the session service can restart normally