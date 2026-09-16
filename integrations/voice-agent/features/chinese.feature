Feature: Chinese voice transcription
  Scenario: Chinese is the default speech recognition language
    Given no speech recognition language override
    When captured audio is sent for transcription
    Then the multipart language is "zh"
    And Chinese text with mixed project names is preserved

  Scenario: Operators select a language or automatic detection
    Given ODESK_VOICE_STT_LANGUAGE is a simple language code with an optional region or "auto"
    When captured audio is sent for transcription
    Then an explicit language is included unchanged
    And "auto" omits the multipart language field

  Scenario: Invalid language configuration is rejected safely
    Given an invalid ODESK_VOICE_STT_LANGUAGE value
    When transcription configuration is validated
    Then transcription is rejected before file access or network requests
    And the error does not include the configured value

  Scenario: Chinese requests and replies retain mixed project names
    Given a Chinese transcript mentioning Open DeskOS and pi-session-control
    When the voice service forwards the request and receives a Chinese reply
    Then the request and reply retain their original Chinese and project names

  Scenario: Provider errors do not reveal private content
    Given a failed transport or malformed transcription response containing private data
    When transcription fails
    Then only a generic transcription error is returned
