Feature: Durable per-host managed coding tasks
  Scenario: Receipt survives client disconnect and identical retries
    Given a configured development root and private task store
    When a start request is accepted and its client disconnects
    Then its receipt is durable before the coding job starts
    And an identical task ID retry returns the existing task
    And a different payload with that ID is rejected

  Scenario: Project and host concurrency are bounded
    Given four independent running projects
    When another task starts or a busy project is requested
    Then the request is rejected without running another job

  Scenario: Overlapping canonical projects cannot run together
    Given a running project and a symlink alias to its child directory
    When another task requests its parent or child through either path
    Then the request is rejected until the running task exits
    And unrelated sibling projects may run concurrently

  Scenario: Persisted receipts are validated before recovery
    Given persisted task receipts in the private task store
    When the service restarts
    Then only complete records with valid task IDs, states, not_run verification, absolute projects and ordered ISO dates are trusted
    And prompts are nonempty and at most 64 KiB of UTF-8 and responses are at most 16 KiB of UTF-8
    And records exceeding 80 KiB or containing malformed UTF-8 or invalid fields fail startup
    And malformed records are not rewritten as interrupted or presented as completed tasks
    And valid terminal states and UTF-8 text at the limits survive restart unchanged
    And all records are validated before any pending or running receipt is rewritten

  Scenario: Real paths restrict admission, not the coding tools
    Given configured roots and a symlink pointing outside them
    When a project outside the roots or under /opt/open-deskos is requested
    Then admission is rejected
    And the service does not claim to sandbox bash

  Scenario: Restart never replays work
    Given a durable running receipt from an earlier process
    When the service restarts
    Then the task is interrupted and the prompt is not replayed

  Scenario: Managed tasks only edit and test
    Given a managed coding session
    When its policy is loaded
    Then automatic installation, commits, pushes, deployments and service restarts are prohibited even when requested

  Scenario: Completion is not verification
    Given a task whose adapter returns after the full prompt
    When its final stop reason is stop
    Then the task is finished with verification not_run
    And response text is limited to 16 KiB
    But length, error, aborted or missing stop reasons never indicate success

  Scenario: Escaped adapter text fits the complete durable receipt
    Given an accepted task with a 64000 byte ASCII prompt
    When its adapter returns 16000 newlines or escaped control text mixed with Unicode
    Then its terminal receipt including JSON escapes and metadata is at most 80 KiB
    And the response is a well-formed Unicode prefix of at most 16 KiB
    And the original prompt and terminal state survive status and restart
    And the service remains available for another task
    And admission reserves room for terminal and interruption metadata and a generic failure explanation

  Scenario: Malformed Unicode cannot poison recovery
    Given a start request containing an escaped lone surrogate in its prompt
    When admission validates the request
    Then it is rejected without creating a receipt or invoking the adapter
    And a valid task can still run and survive restart
    When a valid task adapter returns lone surrogates
    Then replacement characters normalize its response before persistence
    And its terminal response survives restart unchanged

  Scenario: Recorded tasks remain reachable after their project moves
    Given a running task whose project directory is renamed or deleted
    When status or cancellation uses its submitted or canonical project path
    Then the recorded task remains reachable without filesystem admission
    And a different project identity is rejected

  Scenario: Failed runs explain their outcome safely
    Given an adapter returning an error, length, aborted or missing stop reason with empty text
    When its outcome is recorded
    Then failed or cancelled tasks include a nonempty generic explanation
    And provider error details are not exposed

  Scenario: Cancellation propagates to the coding session
    Given a running task
    When it is cancelled
    Then the adapter receives an aborted signal
    And its project remains occupied until the adapter exits
    And its final state is cancelled

  Scenario: Private bounded request response transport
    Given a private Unix socket and short JSON stdin helper
    When a version 1 correlated request is sent
    Then it receives one bounded correlated response
    And invalid, oversized or overdue frames are rejected
    And disconnecting never cancels an accepted task

  Scenario: Malformed project text cannot poison task recovery
    Given a real project containing a replacement character
    When a start request uses a lone surrogate instead
    Then the request is rejected before receipt persistence
    And the task service can restart normally
