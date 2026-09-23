Feature: Device-local speech-to-text bridge
  Scenario: OpenAI-compatible transcription on loopback
    Given the bridge serves a local transcription model on 127.0.0.1
    When a multipart WAV upload arrives at the inference path with or without a bearer
    Then it returns version one JSON with a non-empty text field
    And a bearer that arrives is ignored rather than checked
    And oversized audio never exhausts device memory

  Scenario: One port declaration serves the bridge and the voice agent
    Given the bridge unit carries ODK_STT_PORT as its only port declaration
    When the voice agent has no explicit transcription URL
    Then it derives its loopback endpoint from that same value
    And an invalid ODK_STT_PORT fails startup instead of reaching a remote endpoint

  Scenario: Loopback-only exposure
    Given the bridge is provisioned as a user service
    When its listening socket is inspected
    Then it binds 127.0.0.1 only and never a wildcard or external interface
    And the voice agent reaches it over plain HTTP loopback without cloud credentials
