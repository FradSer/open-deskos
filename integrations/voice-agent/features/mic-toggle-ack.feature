Feature: Recording toggle acknowledgement reflects the accepted operation
  Scenario: Retrying after error never echoes the obsolete error during capture startup
    Given the voice service has an error from the previous request
    When a toggle starts an asynchronous recording retry
    Then the socket does not send the obsolete error as an acknowledgement
    When the recording starts or fails
    Then the socket acknowledges the resulting authoritative state

  Scenario: An unavailable configured service responds without waiting for a capture
    Given recording cannot start and toggle returns without changing configuration error
    When MIC requests a recording
    Then the settled configuration error is returned truthfully
