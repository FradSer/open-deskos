Feature: A resident Voice Agent coordinates work without implementing it
  Scenario: Resuming the coordinator does not restore generic mutation tools
    Given a resident coding conversation with earlier implementation history
    When the Pi session is created or resumed
    Then read, grep, find and ls are available for inspection
    And write, edit, bash and other generic shell tools are unavailable
    And reviewed desk and Hosted Pi capabilities remain available

  Scenario: A coding handoff frees the next Spoken Turn
    Given a configured target accepting a long Hosted Pi coding turn
    When the voice coordinator receives its durable launch receipt and reports acceptance
    Then voice returns to idle while the Hosted Pi remains working
    And the next MIC action starts a new recording
    And neither dismissal nor the next recording cancels that Hosted Pi

  Scenario: No target means no fallback implementation
    Given no configured coding target
    When the coordinator receives a source implementation request
    Then it reports the required target configuration
    And it has no generic mutation tools to implement the request locally

  Scenario: Worker capability is unchanged
    Given an admitted Hosted Pi started by voice or by a Console
    When its session is created
    Then the host's full coding tool set is available
    And there is no voice-origin edit-and-test-only profile
