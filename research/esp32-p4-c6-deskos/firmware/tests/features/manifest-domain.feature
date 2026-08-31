Feature: manifest 域校验(解析、路径、semver、capability 交集)

  Scenario: 合法 schema-v2 manifest 被完整解析
    Given 一个含 schema_version/app_id/version/name/kind/entry/capabilities/dependencies/files 的合法 manifest.json
    When 域层解析该 JSON
    Then 所有字段被填入 odk_manifest_t
    And files[] 每项的 sha256 是 64 位十六进制

  Scenario: Path traversal in manifest files is rejected, not sanitized
    Given the manifest for "evil_pack_01" declares a file with path "../system/secret.bin"
    When the manifest is parsed
    Then the entire package "evil_pack_01" is rejected
    And no file is written to staging

  Scenario: app_id outside the whitelist charset is rejected
    Given the catalog lists an App with app_id "Evil Pack!"
    When the catalog is parsed
    Then the entry is dropped from the installable list

  Scenario: Non-semver manifest version is rejected
    Given the catalog lists a package "bad_version_01" with version "2.0beta3"
    When the package manifest is validated
    Then "bad_version_01" is filtered out of the installable list
    And the catalog entry is marked "invalid version (rejected)"

  Scenario: Peripheral-compatibility check is performed in C, not by an LLM
    Given the board has no audio_capture peripheral populated
    And the manifest for "openai_voice_client_01" declares capability "audio_capture"
    When the user selects it for install
    Then the screen shows "this device lacks the microphone required by this package"
    And the decision is made by deterministic C code comparing the manifest to board_peripherals.yaml
    And no LLM call is made for the compatibility decision
