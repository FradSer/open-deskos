Feature: Explicit personal assistant configuration and private opt-in note memory
  Scenario: Existing coding setup remains unchanged
    Given ODESK_VOICE_AGENT_CONFIG is absent
    When configuration is loaded
    Then the coding profile has no personal skills or memory

  Scenario: Only operator-reviewed local skill files are admitted
    Given a personal JSON configuration with absolute reviewed skill file paths
    When configuration is loaded
    Then only bounded regular local Markdown files are allowed
    And unknown fields, relative paths, links and malformed JSON fail without exposing contents

  Scenario: Remember and forget are current-turn user decisions
    Given private note memory and no current remember command
    When a model asks to update memory
    Then the mutation is rejected
    When the user says "记住 language: zh-CN"
    Then exactly that named note can be saved once
    And a later turn cannot reuse that permission
    When the user says "忘记 language"
    Then that named note can be removed

  Scenario: Memory is bounded private data rather than authorization
    Given a configured private memory path
    When explicitly requested notes are persisted
    Then writes are atomic with directory mode 0700 and file mode 0600
    And common credential patterns are rejected by a heuristic sensitive-data check
    And saved text is treated as untrusted data, never instructions or authorization
    And files larger than 16 KiB, links and insecure existing files are rejected
    And conversations are never automatically stored

  Scenario: Reviewed skills do not grant arbitrary filesystem access
    Given a whitelist of reviewed skills
    When skill_read is called
    Then only a listed skill index can be read
    And no model-selected filesystem path is accepted
