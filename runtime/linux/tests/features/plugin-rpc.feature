Feature: Generic Capability-Gated Main-Process IPC RPC Bridge

  Scenario: Renderer plugin invokes authorized backend RPC action
    Given a plugin declares permission "hardware:process:scan" in its manifest
    And the plugin registers a backend handler for action "scanSessions"
    When the renderer calls "ctx.callBackend('scanSessions', { filter: 'running' })"
    Then the main process validates the plugin identity and permission
    And the backend handler executes and returns the result to the renderer

  Scenario: Renderer plugin is rejected when permission is missing
    Given a plugin does not declare permission "system:privilege:raw" in its manifest
    When the renderer attempts to invoke action "rawSystemExec"
    Then the main process rejects the call with an explicit permission-denied error
    And the main process does not execute any backend logic
