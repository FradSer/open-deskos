Feature: Explicit personal assistant configuration and private opt-in note memory
  Scenario: Existing coding setup remains unchanged
    Given ODK_PERSONAL_AGENT_CONFIG is absent
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
    Then writes are atomic with directory mode 0700 and file mode 0600 on POSIX hosts
    And Windows writes use private owner ACLs for new directories and files
    And existing broad ACLs are rejected without changing their permissions
    And common credential patterns are rejected by a heuristic sensitive-data check
    And saved text is treated as untrusted data, never instructions or authorization
    And files larger than 16 KiB, links and insecure existing files are rejected
    And conversations are never automatically stored

  Scenario: Reviewed skills do not grant arbitrary filesystem access
    Given a whitelist of reviewed skills
    When skill_read is called
    Then only a listed skill index can be read
    And no model-selected filesystem path is accepted

  Scenario: Startup verifies Jev through one public typed request
    Given a new resident service and a private Jev credential
    When the service starts before clients connect
    Then its status contains Jev checking until one fixed public Noul request completes
    And only a valid typed response marks authentication verified, regardless of its probability
    And missing credentials, rejected access and unavailable transport have separate safe statuses
    And reconnects and later conversation frames retain the result without another request
    And stopping the service aborts the check and prevents a late verified result

  Scenario: Native Pi configuration owns models and credentials
    Given Pi has saved credentials, model overrides, and default model settings
    When Personal Agent starts or changes its model
    Then it uses Pi ModelRuntime and SettingsManager without provider-specific overrides
    And Jev resolves its classifier credentials through the same Pi authentication chain

  Scenario: Configure Pi from the composer
    Given Personal Agent has no authenticated model
    When the owner opens /login from the command dropdown
    Then Pi supplies provider choices and authentication prompts
    And secrets are excluded from messages and status broadcasts
    When the owner selects /model or /thinking
    Then native Pi choices apply to the resident and persist as Pi defaults
    And configuration changes are refused while a request is active

  Scenario: Rename staging requires the previous service to be stopped
    Given a previous Personal Bot unit is active or enabled
    When the CM5 installer stages Personal Agent
    Then staging fails before system packages or service definitions change
    And the operator must stop and disable the previous unit before activation

  Scenario: Native Pi executes Jev classification without a chat model
    Given native Pi has a TypeSafe classifier and stored credentials
    When a scheduled judgment requests typed questions
    Then Personal Agent calls ModelRuntime.classify with bool or choice questions
    And only a successful stopReason can supply judgment answers
    And classifier models never enter the chat model selector

  Scenario: Explicit login restores an unavailable Jev classifier
    Given an ordinary model is ready and Jev authentication failed at startup
    When the owner completes Pi login and its public Jev check succeeds
    Then Jev judgments resume without restarting the service
    And unrelated transient failures do not cause automatic retries

  Scenario: Retired configuration cannot silently select the wrong profile
    Given a copied service configuration still contains the previous Agent variable prefix
    When the service validates its environment or CM5 stages the release
    Then validation fails before runtime creation or service writes
    And the operator receives migration guidance without configuration values
