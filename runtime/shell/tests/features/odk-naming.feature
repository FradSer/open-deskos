Feature: One ODK technical namespace

  Scenario: Hosts use the ODK state and channel names
    Given a Linux, macOS, or Windows Shell Host
    When the host resolves its state directory and data endpoint
    Then the state directory uses the odk name
    And the data endpoint uses the odk-data name
    And no previous endpoint name is available

  Scenario: Data clients use the same namespace as the Shell
    Given a Personal Agent on Windows or Linux
    When it resolves its default data endpoint
    Then it uses the Shell endpoint for that host
    And previous environment variable names do not override it

  Scenario: The shared control fixture signs the canonical protocol
    Given the Shell and Pi Console use the odk-control-v2 domain
    When a client signs the fixture transcript
    Then its HMAC matches the published fixture proof
    And both packages contain the same fixture bytes

  Scenario: The Personal Agent reads through an ODK tool
    Given the Personal Agent loads the data capability
    When it registers that capability
    Then the tool is odk_data in the odk namespace

  Scenario: The CM5 Hosted Pi helper uses the canonical namespace
    Given a release includes the reviewed Hosted Pi control helper
    When the installer stages its user-owned executable
    Then its name is odk-pi-task-control
    And active installer source contains no retired helper prefix
