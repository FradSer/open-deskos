Feature: Local Pi Sessions Monitoring

  Scenario: Linux shell detects and exposes local Pi sessions
    Given local Pi session metadata directories exist in the agent state
    When the shell queries active Pi sessions
    Then it identifies running, settled, and exited sessions by checking process liveness
    And it returns session IDs, working directory paths, latest goals, and modified files
    And sessions are sorted by latest activity time

  Scenario: Pi Sessions widget displays glanceable live session status without controls
    Given the Home grid displays the Pi Sessions widget
    When active Pi sessions are running locally
    Then the widget displays the number of running sessions and an active status badge
    And the widget is non-interactive and does not open an App on click

  Scenario: Linux shell includes running Pi processes even without session metadata
    Given a running direct or supported-wrapper `pi` process is visible to the local process table
    And no matching session metadata exists for its PID
    When the shell queries active Pi sessions
    Then it includes the process with its PID, working directory, and elapsed runtime
    And it marks the process as running without inventing a goal or modified files

  Scenario: Linux shell merges process facts into a matching metadata record
    Given a live Pi process and session metadata share the same PID
    When the shell queries active Pi sessions
    Then it returns one record for that PID
    And it keeps the session goal and modified files while filling missing process facts

  Scenario: Pi Sessions App page displays workspaces, session goals, and modified files
    Given the user navigates to the Pi Sessions page
    When sessions are loaded from the local agent state
    Then sessions are grouped by workspace directory
    And each session card shows its process status, PID, elapsed time, and latest goal
    And each session displays the list of modified files
    And users can filter sessions by status or trigger a manual refresh

  Scenario: Pi Sessions status bar indicator provides system-level glanceability
    Given the status plugin for Pi Sessions is registered
    When active Pi sessions are running locally
    Then the status bar displays the running count with an active indicator
    And selecting the status bar indicator navigates to the Pi Sessions page
