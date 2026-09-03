Feature: Local Pi Sessions Monitoring

  Scenario: Linux shell detects and exposes local Pi sessions
    Given local Pi session metadata directories exist in the agent state
    When the shell queries active Pi sessions
    Then it identifies running, settled, and exited sessions by checking process liveness
    And it returns session IDs, working directory paths, latest goals, and modified files
    And sessions are sorted by latest activity time

  Scenario: Pi Sessions widget displays glanceable live session status
    Given the Home grid displays the Pi Sessions widget
    When active Pi sessions are running locally
    Then the widget displays the number of running sessions and an active status badge
    And the widget is interactive and opens the Pi Sessions app on click

  Scenario: Pi Sessions app displays workspaces, session goals, and modified files
    Given the user opens the Pi Sessions app
    When sessions are loaded from the local agent state
    Then sessions are grouped by workspace directory
    And each session card shows its process status, PID, elapsed time, and latest goal
    And each session displays the list of modified files
    And users can filter sessions by status or trigger a manual refresh

  Scenario: Pi Sessions status bar indicator provides system-level glanceability
    Given the status plugin for Pi Sessions is registered
    When active Pi sessions are running locally
    Then the status bar displays the running count with an active indicator
    And selecting the status bar indicator opens the Pi Sessions app
