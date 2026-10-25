Feature: Managed Python services use owned user units
  Scenario: An enabled revision starts through the runtime manager
    Given an available Linux user service manager and an unused unit identity
    When the operator enables a prepared Python revision
    Then its private unit launches the manager with the exact revision
    And arguments preserve spaces and percent characters without a shell
    And the unit contains no operator credential values

  Scenario: An unrelated unit cannot be changed
    Given the same unit name resolves outside the managed root
    When the runtime starts, stops, or removes that unit
    Then it refuses all service mutations

  Scenario: Removal preserves unrelated files and confirms shutdown
    Given an exactly owned running service unit
    When the runtime removes that service
    Then it stops the complete service control group
    And it confirms the unit is inactive before removing its managed unit file
    And it disables the managed unit and reloads the user service manager

  Scenario: Interrupted cleanup retains recoverable ownership
    Given the runtime reserves ownership before starting a service
    And unit removal succeeds before the final manager reload fails
    When the operator retries cleanup with the retained handle
    Then confirmed inactivity and the expected fragment permit the reload
    And confirmed unit absence completes cleanup
    But unavailable ownership evidence cannot authorize another unit mutation

  Scenario: Systemd reports its installed user unit symlink
    Given systemd links the private unit into its user configuration directory
    When its fragment resolves through the owned link to the exact managed file
    Then startup, status, and removal accept that fragment
    But a replaced link cannot authorize service mutations

  Scenario: A malformed owned unit never started
    Given an exactly owned unit has bad-setting load state
    And its active state is inactive and its main process identifier is zero
    When the operator retries cleanup
    Then the runtime disables the unit and removes its owned file
    But an active malformed unit retains its recovery handle

  Scenario: Disabling immediately unloads the owned unit
    Given the runtime verified the inactive unit and its installed link
    When disabling removes the link and systemd immediately reports unit absence
    Then confirmed absence permits removal of the verified source file
    But a replacement fragment or remaining process prevents source removal
