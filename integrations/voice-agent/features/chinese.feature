Feature: Simplified Chinese and mixed-language voice transcription
  Scenario: Chinese is the default speech recognition language
    Given no speech recognition language override
    When captured audio is sent for transcription
    Then the multipart language is "zh"

  Scenario: Operators select an upstream language code
    Given ODESK_VOICE_STT_LANGUAGE is a two or three lowercase letter language code
    When captured audio is sent for transcription
    Then the explicit language is included unchanged

  Scenario: Automatic language detection is explicit for local whisper.cpp
    Given ODESK_VOICE_STT_LANGUAGE is "auto"
    When captured audio is sent to a loopback HTTP or HTTPS URL with pathname /inference
    Then the multipart language is "auto"
    And multipart translate is "false" to preserve the spoken language

  Scenario: Standard OpenAI-compatible endpoints do not receive whisper.cpp options
    Given ODESK_VOICE_STT_LANGUAGE is "auto"
    When captured audio is sent to a non-loopback endpoint or a different pathname
    Then the multipart language and translate fields are omitted

  Scenario: Invalid language configuration is rejected safely
    Given an invalid ODESK_VOICE_STT_LANGUAGE value including "zh-CN"
    When transcription configuration is validated
    Then transcription is rejected before file access or network requests
    And the error does not include the configured value
    And startup guidance recommends a two or three letter code or auto without region suffixes

  Scenario: Complete validated transcripts are normalized to Simplified Chinese
    Given a provider returns Traditional Chinese mixed with English names and punctuation
    When the complete valid transcript is received
    Then OpenCC converts Traditional Chinese to Simplified Chinese
    And English spelling, case, punctuation and line breaks remain unchanged
    And the voice display and agent receive the same normalized transcript within the display bound

  Scenario: English transcription is not translated or rewritten
    Given a provider returns only English with product names and punctuation
    When the complete valid transcript is received
    Then the original English is preserved

  Scenario: A short mixed-language transcription context supplies product vocabulary
    Given no ODESK_VOICE_STT_PROMPT override
    When captured audio is sent for transcription
    Then the multipart prompt is a short Simplified Chinese and English transcription example
    And it includes Open DeskOS, CM5, ESP32-P4, Pi, Agent, MIC, Back, Markdown, GitHub and TypeScript

  Scenario: Operators can replace or disable transcription context
    Given ODESK_VOICE_STT_PROMPT is configured with at most 1024 characters
    When startup configures transcription and audio is submitted
    Then the exact configured prompt is used
    And an explicitly empty prompt omits the multipart prompt field

  Scenario: Oversized transcription context is rejected safely
    Given ODESK_VOICE_STT_PROMPT exceeds 1024 characters
    When startup or transcription validates configuration
    Then a safe configuration error rejects the prompt before transcription I/O
    And the error does not include the configured value

  Scenario: Agent instructions default to Simplified Chinese
    Given the voice coordinator loads its instructions
    Then it defaults to Simplified Chinese for understanding, delegation and replies
    And it respects an explicitly requested other language

  Scenario: Chinese requests and replies retain mixed project names
    Given a Chinese transcript mentioning Open DeskOS and pi-session-control
    When the voice service forwards the request and receives a Chinese reply
    Then the request and reply retain their original Chinese and project names

  Scenario: Provider errors do not reveal private content
    Given a failed transport or malformed transcription response containing private data
    When transcription fails
    Then only a generic transcription error is returned
