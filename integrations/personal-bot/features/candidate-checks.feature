Feature: Check results carry host-observed source evidence
  Scenario: A completed check reports process evidence rather than certification
    Given a Hosted Pi with a readable Git project
    When it runs coding_check with a command and the source is unchanged
    Then the tool result records the observed exit code and matching source samples
    And session history carries that evidence with the tool result
    And finished and verification not_run keep their existing meanings

  Scenario: Changed source is not the same checked candidate
    Given a command that changes source while it runs
    When the check completes
    Then its before and after source samples differ
    And its evidence does not claim the same source was checked

  Scenario: Source identity covers more than HEAD or a diff
    Given tracked files, deletions, executable modes, symlinks and nonignored new files
    When any of those source values changes
    Then the source digest changes
    But ignored files and symlink target contents outside the project are outside the sample

  Scenario: Missing or excessive scope does not invent a source identity
    Given a non-Git, unreadable, unstable or oversized source scope
    When a check is requested
    Then its command still runs with normal worker capability
    And unavailable source samples are reported honestly

  Scenario: Evidence survives a bounded history frame
    Given a check result with escaped command output and a near-limit durable task
    When the coordinator reads the existing session history
    Then host metadata precedes bounded output rather than being lost by truncation
    And the complete response fits the transport frame with explicit continuation
    And assistant claims are not projected as host check metadata

  Scenario: A single oversized history entry cannot loop on its own cursor
    Given one persisted assistant entry with many tool calls or heavily escaped arguments
    When that entry exceeds a complete history page budget
    Then history refuses with its physical position and an actionable reason
    And it never returns the requested position as its continuation

  Scenario: Check metadata has bounded output and credential-aware command labels
    Given a check command with common inline credential carriers and verbose output
    When the check executes and its result is persisted
    Then host metadata labels redact those credential-shaped values
    And the command digest identifies the exact executed command
    And the script output stays inside a 64 KiB bound without a temporary full-output path
    But command arguments and output in the ordinary worker transcript are not a secret vault

  Scenario: Interrupted and failing processes do not become passing checks
    Given a failing, timed-out or cancelled command
    When its result is recorded
    Then its observed outcome is distinct from exit zero
    And evidence is bounded and private in the existing session log
