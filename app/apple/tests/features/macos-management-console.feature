Feature: macOS plugin management console
  The macOS client manages the local Wispr Flow sidecar without turning the
  cross-platform client into a macOS-only application.

  Scenario: Configure and run the Wispr Flow sidecar
    Given the macOS client has not been granted a Wispr Flow session file
    When the person chooses session.json from the Wispr Flow app
    Then the console shows that a session is configured
    And the person can start, stop, and restart the local sidecar
    And a failed start explains what must be configured or repaired

  Scenario: Replace the session of a running Wispr Flow sidecar
    Given the Wispr Flow sidecar is running with an existing session
    When the person chooses a replacement session.json
    Then OpenDeskOS restarts the sidecar before it uses the new session

  Scenario: Check the local sidecar from the console
    Given Wispr Flow is running on 127.0.0.1:8787
    When the person runs a health check in the console
    Then the console reports the HTTP result, response time, and check time
    And an unavailable sidecar shows a retryable error instead of stale health

  Scenario: Cancel an in-flight health check when sidecar state changes
    Given the console is checking Wispr Flow health
    When the person starts, stops, or restarts the sidecar
    Then the in-flight result cannot overwrite the new health state

  Scenario Outline: Enable a managed background health check
    Given the person selects the "<schedule>" schedule
    When the person enables background health checks
    Then the app registers the bundled LaunchAgent for "<interval>" seconds
    And macOS can show whether the agent is enabled or needs approval
    And the agent invokes the bundled OpenDeskOS without starting Bun itself

    Examples:
      | schedule       | interval |
      | Every 5 minutes  | 300      |
      | Every 15 minutes | 900      |
      | Every 30 minutes | 1800     |
      | Every hour       | 3600     |

  Scenario: Use a custom sidecar port with the appropriate scheduler
    Given Wispr Flow is configured on a non-default FLOW_API_PORT
    When the person opens Automation
    Then the console explains that bundled automation checks 127.0.0.1:8787
    And it provides a standalone CLI command for the configured endpoint

  Scenario: Stop stale app-managed checks after the endpoint changes
    Given a bundled app-managed health check is already enabled
    And Wispr Flow is configured on a non-default or invalid FLOW_API_PORT
    When the console refreshes Automation
    Then it unregisters the bundled health check instead of leaving it on port 8787
    And it offers the standalone CLI command for the configured endpoint

  Scenario: Check a token-protected sidecar without copying its secret
    Given the local sidecar is configured with FLOW_API_TOKEN
    When the app-managed background agent runs its bundled health check
    Then the loopback-only health endpoint responds without a bearer token
    And transcription endpoints still require the bearer token
    And the agent pins FLOW_API_PORT to 8787
    And no bearer token is stored in the signed LaunchAgent plist

  Scenario: Disable a managed background health check
    Given a managed background health check is enabled
    When the person disables it in the console
    Then the app unregisters its managed LaunchAgent
    And the console shows that no app-managed background check is active

  Scenario: Refresh a managed background health check after an app update
    Given a managed background health check is already enabled
    When the person applies the selected schedule from an updated OpenDeskOS app
    Then the app unregisters the selected LaunchAgent before registering its bundled version
    And the refreshed agent uses the current bundled OpenDeskOS

  Scenario: Explain an unavailable bundled background helper
    Given macOS cannot discover the bundled background helper in the current app copy
    When the person opens Automation
    Then the console identifies the helper as unavailable
    And it explains that a signed installed OpenDeskOS copy is required
