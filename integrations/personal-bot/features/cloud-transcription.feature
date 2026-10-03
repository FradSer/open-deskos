Feature: Declared Aliyun/Qwen cloud transcription
  A desk without a local ASR model can transcribe through Alibaba Cloud. The provider is declared
  explicitly, and the adapter encodes the one request shape dashscope.aliyuncs.com and the MaaS
  proxy accept: a multimodal generation call whose only user content is the recording, inlined as a
  WAV data URI because those endpoints do not read local paths.

  Scenario: Cloud transcription is declared rather than inferred from the endpoint
    Given no transcription provider override
    When a desk with no local ASR model sends a recording for transcription
    Then the declared provider is openai and the request is multipart
    And a desk that declares ODESK_PERSONAL_BOT_STT_PROVIDER as "aliyun" uses the cloud JSON request
    And the endpoint hostname alone never selects the transport

  Scenario: Undeclared provider values are rejected before any I/O
    Given a transcription provider that is not "openai" or "aliyun", including "dashscope" and "ALIYUN"
    When transcription configuration is validated
    Then transcription is rejected before file access or network requests
    And the error does not include the configured value

  Scenario: The cloud request is JSON carrying the recorded audio
    Given the declared provider is aliyun and a captured WAV exists
    When captured audio is sent for transcription
    Then the request is a POST with an Authorization bearer and Content-Type application/json
    And the body is a JSON string, not a multipart form
    And the model is the configured model, or qwen3-asr-flash when the desk sets none
    And input.messages carries the user message whose audio is a data:audio/wav;x-pcm-16bit;base64, URI
    And the base64 payload decodes back to the recorded bytes
    And parameters.result_format is "message"
    And no request field carries a local path or the credential

  Scenario: The cloud bearer comes from the environment token
    Given ALIYUNCS_TOKEN is a trimmed, nonempty token in the desk environment
    When captured audio is sent for transcription
    Then the Authorization header is that token as a bearer
    And a configured ODESK_PERSONAL_BOT_STT_KEY_FILE is not read and not sent on this transport
    And a missing or blank token fails with the missing credential error before any request

  Scenario: Provider language codes are sent unchanged
    Given ODESK_PERSONAL_BOT_STT_LANGUAGE is a two or three lowercase letter language code
    When captured audio is sent to the cloud provider
    Then asr_options.language is that exact code
    And asr_options.enable_lid is absent

  Scenario: Automatic language detection is explicit for the cloud provider
    Given ODESK_PERSONAL_BOT_STT_LANGUAGE is "auto"
    When captured audio is sent to the cloud provider
    Then asr_options.enable_lid is true
    And no asr_options.language key is sent at all

  Scenario: Inverse text normalization stays off for product vocabulary
    Given the cloud provider is declared
    When any recording is sent
    Then asr_options.enable_itn is false
    And digits inside product vocabulary are not rewritten by the provider

  Scenario: Transcription context becomes the system message
    Given no ODESK_PERSONAL_BOT_STT_PROMPT override
    When captured audio is sent to the cloud provider
    Then the system message text is the short Simplified Chinese and English transcription example
    And it includes Open DeskOS, CM5, ESP32-P4, Pi, Agent, MIC, Back, Markdown, GitHub and TypeScript

  Scenario: Operators can replace or disable the cloud context
    Given ODESK_PERSONAL_BOT_STT_PROMPT is configured with at most 1024 characters, or is empty
    When captured audio is sent to the cloud provider
    Then the exact configured context becomes the system message text
    And an explicitly empty context omits the system message entirely rather than sending empty text
    And an oversized context is rejected before transcription I/O

  Scenario: The cloud transport keeps the endpoint and size rules
    Given the declared provider is aliyun
    When the endpoint carries URL credentials, is not HTTPS, or is plain HTTP outside loopback
    Then transcription is rejected with an invalid transcription URL error before any request
    And a declared loopback HTTP proxy keeps the same rule the Open DeskOS URL check applies
    And recordings are bounded by the same 25,000,000 byte limit
    And the size is checked before the credential is read and before the audio is read into memory
    And the request keeps the 45 second deadline, refuses redirects and bounds the response to 64KiB

  Scenario: Cloud provider failures stay generic
    Given a transport error, a rejected token, a malformed or oversize provider response, or a blank transcript
    When transcription fails
    Then only a generic transcription error, or the empty transcript error, is returned
    And no response text, credential, endpoint or recorded audio appears in the error or a log

  Scenario: Cloud transcripts are normalized like every other provider
    Given the provider message contains Traditional Chinese mixed with English names and punctuation
    When the complete valid transcript is received
    Then OpenCC converts Traditional Chinese to Simplified Chinese and surrounding whitespace is trimmed
    And English spelling, case, punctuation and line breaks remain unchanged

  Scenario: The wire contract is asserted with a fake transport, not with a provider call
    Given these scenarios are exercised with a fake fetch and local fixtures
    Then the request shape, credential source, language mapping, context mapping and failure vocabulary are proven
    And provider acceptance of a real recording, the real account quota and real Chinese speech remain unproven
    And a desk that depends on this provider still needs authorized on-device acceptance
