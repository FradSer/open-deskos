Feature: OpenDeskOS macOS CLI background management
  The macOS CLI provides a headless health check for the Wispr Flow sidecar
  and lets the user schedule that check with a per-user launchd agent.

  Scenario: The CLI exposes plugin health and daemon management commands
    When the user runs "OpenDeskOS --help"
    Then the help lists "plugin health"
    And the help lists "daemon install"
    And the help lists "daemon uninstall"
    And the help lists "daemon status"

  Scenario: The subscription pull keeps the device wall clock synced
    Given a OPEN_DESKOS device is connected over USB serial
    When the user runs "OpenDeskOS sub pull"
    Then the bridge first pushes "cerb settime <epoch>" to the device
    And the bridge then polls "cerb sub status"
    And the bridge fetches and pushes live usage only when the device asks (refresh=yes)

  Scenario: Installing the daemon schedules a health check at the requested interval
    Given the CLI executable path is resolved to an absolute path
    And the requested daemon interval is 900 seconds
    When the user runs "OpenDeskOS daemon install --interval 900"
    Then a per-user LaunchAgent is written under "~/Library/LaunchAgents"
    And its program arguments begin with "<cli> plugin health --daemon"
    And its StartInterval is 900 seconds
    And the agent is loaded and kicked off immediately

  Scenario: A daemon installed from PATH keeps the resolved executable and configured port
    Given the user invokes "OpenDeskOS" through PATH
    And FLOW_API_PORT is 18787
    When the user installs the daemon
    Then the LaunchAgent records the resolved absolute OpenDeskOS path
    And the LaunchAgent checks "http://127.0.0.1:18787/health"

  Scenario: Daemon status reports the last health-check result
    Given the daemon has recorded a successful health check
    When the user runs "OpenDeskOS daemon status"
    Then the command reports whether the LaunchAgent is running or waiting
    And the command reports the timestamp and outcome of the last check

  Scenario: A healthy Wispr Flow sidecar returns success
    Given the sidecar health endpoint returns HTTP 200
    When the user runs "OpenDeskOS plugin health"
    Then the command reports the sidecar as healthy
    And the command exits successfully

  Scenario: The CLI uses the configured Wispr Flow port by default
    Given FLOW_API_PORT is 18787
    And the sidecar health endpoint on port 18787 returns HTTP 200
    When the user runs "OpenDeskOS plugin health"
    Then the command reports the sidecar as healthy

  Scenario: A successful daemon health check survives unavailable state storage
    Given the sidecar health endpoint returns HTTP 200
    And the CLI cannot write its last-run state
    When the user runs "OpenDeskOS plugin health --daemon"
    Then the command reports the sidecar as healthy
    And the command exits successfully

  Scenario: An explicit endpoint overrides an invalid port environment
    Given FLOW_API_PORT is invalid
    And the selected health endpoint returns HTTP 200
    When the user runs "OpenDeskOS plugin health --url <endpoint>"
    Then the command reports the selected sidecar as healthy

  Scenario: An unavailable Wispr Flow sidecar returns failure
    Given the sidecar health endpoint cannot be reached or returns a non-2xx response
    When the user runs "OpenDeskOS plugin health"
    Then the command reports the sidecar as unavailable
    And the command exits with a non-zero status
