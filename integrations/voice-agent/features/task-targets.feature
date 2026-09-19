Feature: Managed independent coding tasks
  Scenario: Discover configured development targets without probing hosts
    Given a target configuration with CM5 and Mac development roots
    When the coordinator lists coding targets
    Then only configured IDs, names and roots are returned without health claims

  Scenario: Send Chinese coding work through a fixed launcher
    Given an explicitly selected target and absolute project under a configured root
    When a Chinese coding request starts a task
    Then a UUID task ID and correlated version 1 JSON request are sent on stdin
    And SSH uses a quoted configured launcher and strict host verification

  Scenario: Reconcile an unknown start outcome without retrying
    Given a start request whose transport times out or returns an invalid response
    When the coordinator reports the failure
    Then the target and original task ID remain available for status reconciliation
    And the mutation is not retried

  Scenario: Reject invalid configuration and ambiguous projects
    Given duplicate IDs, unexpected configuration keys or invalid paths
    When coding targets are loaded or a task is requested
    Then the request is rejected before transport

  Scenario: Bound and correlate control replies
    Given an independent task on an explicitly selected target and project
    When status, list or cancel is requested
    Then only a matching version and request ID reply is accepted
    And control has a ten second deadline and 256 KiB output limit
    And task listing is exposed as coding_tasks_list

  Scenario: Abort uncertain mutations without retry
    Given a task start or cancel request whose control signal is aborted
    When the coordinator reports the failure
    Then the original task ID and project remain available for reconciliation
    And the mutation is not retried

  Scenario: Chinese coordinator preserves safe defaults
    Given a voice request without another language preference
    When the coordinator interprets the request
    Then it replies in Chinese and asks about ambiguous target or project intent
    And accepted work is not reported as completed
    And delegated Hosted Pi work is not narrowed by an edit-and-test-only capability instruction
    And trusted capabilities and user application lifecycle tools remain available

  Scenario: Known task rejection remains actionable without exposing arbitrary errors
    Given a correlated response from the configured task host
    When the host rejects a busy project or missing task
    Then the coordinator receives the safe known reason
    And unknown error text is replaced with a generic rejection
