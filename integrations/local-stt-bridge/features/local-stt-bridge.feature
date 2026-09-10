Feature: Device-local speech-to-text bridge
  Scenario: OpenAI-compatible transcription on loopback
    Given the bridge serves a local transcription model on 127.0.0.1
    When a multipart WAV upload arrives at the inference path with bearer authentication
    Then it returns version one JSON with a non-empty text field
    And oversized audio never exhausts device memory

  Scenario: Loopback-only exposure
    Given the bridge is provisioned as a user service
    When its listening socket is inspected
    Then it binds 127.0.0.1 only and never a wildcard or external interface
    And the voice agent reaches it over plain HTTP loopback without cloud credentials
