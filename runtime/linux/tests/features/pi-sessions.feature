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

  Scenario: Linux shell preserves complete facts across duplicate metadata files
    Given duplicate metadata files describe one Pi session at different update times
    And the newer file omits a previously known workspace or command
    When the shell queries active Pi sessions
    Then it keeps the newer session state and activity timestamp
    And it retains the older non-empty facts instead of inventing replacements

  Scenario: Linux shell refuses to merge indistinguishable live PID metadata
    Given two live Pi metadata records share one PID and have near-identical start times
    When the shell queries active Pi sessions
    Then it retains the process record and does not choose one metadata record arbitrarily
    And the ambiguous metadata records remain historical rather than being marked as the live process

  Scenario: Pi Sessions App page displays workspaces and session goals without modified file badges
    Given the user navigates to the Pi Sessions page
    When sessions are loaded from the local agent state
    Then sessions are grouped by workspace directory
    And each session card shows its process status, PID, elapsed time, and latest goal
    And each session card omits secondary modified file badges for a compact view
    And users can filter sessions by status or trigger a manual refresh

  Scenario: Pi Sessions controls reflow inside a narrow App page
    Given the user opens Pi Sessions in a narrow portrait window
    When the App toolbar renders its filters and refresh action
    Then every control stays inside the App surface without horizontal clipping
    And the filters remain individually selectable

  Scenario: Pi Sessions status bar indicator provides system-level glanceability
    Given the status plugin for Pi Sessions is registered
    When active Pi sessions are running locally
    Then the status bar displays the running count with an active indicator
    And selecting the status bar indicator navigates to the Pi Sessions page

  Scenario: Pi Sessions widget prioritizes primary numeral over supporting description
    Given the Pi Sessions widget is mounted on the Home grid
    When session state is displayed across themes
    Then the running count is the dominant visual numeral
    And the supporting source or workspace description text uses compact legible type

  Scenario: Pi Sessions fullscreen App renders a compact session list
    Given multiple sessions are rendered in the Pi Sessions App feed
    When viewing the session list on desktop display
    Then session cards use compact vertical padding and inline goal alignment
    And multiple running sessions fit within the initial visible viewport

  Scenario: Pi Sessions App formats skill invocation goals as [skill] name
    Given a session goal contains a skill tag
    When the session card is rendered
    Then the skill name is displayed with a bracketed skill indicator similar to the default TUI style
    And raw skill XML tags are omitted

  Scenario: Pi Sessions App displays active model activity
    Given an active Pi session is running
    When the session card is rendered
    Then the card displays a model activity message indicating current work
