Feature: User applications page
  Scenario: Manage installed applications and display their metadata safely
    Given the user applications API lists an installed application
    When the User applications page mounts
    Then it renders the app name, version, revision, and lifecycle controls as text
    And metadata is not interpreted as HTML

  Scenario: Open and close an application frame safely
    Given the user applications API lists an installed application
    When the user opens and closes that application
    Then the display-only user frame is disposed before it is removed
    And the frame has an accessible title

  Scenario: Recover when the user applications backend is unavailable
    Given the user applications API is unavailable
    When the User applications page mounts
    Then the page remains usable and announces that applications are unavailable
