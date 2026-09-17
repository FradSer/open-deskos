Feature: Microphone intent preserves background voice requests
  Scenario: Remote microphone lets the Shell decide whether to restore feedback
    Given a resident Voice Agent and Shell are available
    When Remote MIC is pressed
    Then the Shell receives a microphone intent
    And no recording toggle or fabricated Preparing state is sent before the Shell decides

  Scenario: Busy and pending toggles cannot begin a second request
    Given a recording start or submission has been accepted but not acknowledged
    When another toggle reaches main
    Then main rejects the duplicate without sending another service command
    And stale idle or recording acknowledgements do not clear the pending operation or replace its feedback
    When the service reports transcribing or thinking
    Then toggles remain rejected without replacing the current content
    When the service reports recording
    Then a deliberate toggle can submit once

  Scenario: Reconnection during hidden microphone startup preserves dismissal
    Given microphone startup feedback was hidden with Back
    When the service reconnects with an empty idle snapshot before recording starts
    Then the later recording snapshot does not reopen feedback
    And MIC can explicitly restore that recording without submitting it

  Scenario: Microphone intent subscriptions are scoped
    Given a renderer subscribes to microphone intents through preload
    When main sends the microphone event
    Then the subscriber is notified once
    When it unsubscribes
    Then later events no longer notify it
