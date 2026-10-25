Feature: Recording toggle acknowledgement reflects the accepted operation
  Scenario: Retrying after error never echoes the obsolete error during capture startup
    Given the Personal Agent service has an error from the previous request
    When a toggle starts an asynchronous recording retry
    Then the socket does not send the obsolete error as an acknowledgement
    When the recording starts or fails
    Then the socket acknowledges the resulting authoritative state

  Scenario: An unavailable configured service responds without waiting for a capture
    Given recording cannot start and toggle returns without changing configuration error
    When MIC requests a recording
    Then the settled configuration error is returned truthfully

  Scenario: Explicit cancellation discards the active recording
    Given a local or display microphone is recording
    When the owner cancels the recording
    Then cleanup finishes before another input can start
    And late recording completion cannot transcribe or submit audio
    And a cleanup failure retains ownership and reports the actual failure

  Scenario: Central cancellation waits for display cleanup
    Given a display owns a recording with delayed or failed cleanup
    When the central control cancels the recording
    Then central ownership remains reserved until the display confirms cleanup
    And the display cannot acquire another microphone during cleanup
    And cancelled audio cannot enter transcription

  Scenario: Cancellation races with a remote acknowledgement
    Given the display start acknowledgement is still pending
    When central cancellation reserves the recording for cleanup
    Then the late start acknowledgement cannot resume audio transfer
    Given complete audio has already entered final handoff
    When cancellation loses this handoff race
    Then cancellation returns a refusal without a pending request
    And the accepted audio is submitted once

  Scenario: Resident configuration preserves remote capture context
    Given voice configuration permits remote recording
    When the resident reserves a display capture
    Then it retains the originating application binding and cancellation callback
    And unavailable voice configuration refuses the reservation

  Scenario: Display cancellation requires completed host registration
    Given a display received recording status before its host registration acknowledgement
    When a local client requests cancellation
    Then no cancellation action reaches the voice adapter
    And the client receives unavailable status
    When host registration completes
    Then cancellation reaches the voice adapter
