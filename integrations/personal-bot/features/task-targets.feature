Feature: Managed independent coding tasks
  Scenario: An incomplete native inventory does not prove a missing session
    Given a root inventory with one endpoint that did not answer
    When the helper returns incomplete true and unavailable one
    Then the coordinator preserves both fields
    And it reports incomplete inventory rather than a missing session
    And it does not launch a replacement for the unresolved session

  Scenario: Continue an ordinary remote Pi through its published endpoint
    Given a configured helper and two Pi sessions below a development root
    When the Personal Bot lists the root and resolves the selected session
    Then its next prompt uses that session's exact project and task ID
    And Chinese prompt text reaches that same session without a replacement launch
    And an unspecified native delivery follows normal Pi Enter behavior
    And explicit steering and follow-up remain available
    And native admission stays unknown even when the session observes matching message text
    And observed session execution facts do not certify a particular mutation

  Scenario: Preserve a native session's fixed refusal
    Given a native Pi endpoint that cannot serve history or accept a prompt
    When its correlated reply supplies a known refusal
    Then the Personal Bot receives that exact refusal
    And arbitrary endpoint error text remains hidden

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

  Scenario: Preserve the mutation identity after a lost prompt reply
    Given a helper that receives a prompt but loses its response
    When the Personal Bot reports the unknown outcome
    Then its failure includes the exact mutation ID sent to the helper
    And it includes no prompt text or credentials
    And a matching session message does not certify that mutation's admission

  Scenario: Reject invalid configuration and unshippable requests
    Given duplicate IDs, unexpected configuration keys, an unnormalized project or invalid task text
    When coding targets are loaded or a task is requested
    Then the request is rejected before transport

  Scenario: The host answers for project admissibility
    Given a configured target whose declared roots do not contain the requested project
    When the coordinator sends that request
    Then the project travels unchanged and is not refused by the coordinator
    And the host's own refusal is what the coordinator reports

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
