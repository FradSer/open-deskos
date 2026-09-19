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

  Scenario: Linux shell ignores live Pi processes without session metadata
    Given a running direct or supported-wrapper `pi` process is visible to the local process table
    And no matching session metadata exists for its PID
    When the shell queries active Pi sessions
    Then it excludes the process from the session list instead of inventing a session
    And it reports the unmatched process only as a hidden-worker count for diagnostics

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
    Then it does not choose one metadata record arbitrarily
    And the ambiguous metadata records remain historical rather than being marked as the live process
    And no synthetic process session is created for the live PID

  Scenario: Linux shell hides Pi worker processes spawned by another live Pi session
    Given a live Pi process whose parent process is also a live Pi session
    When the shell queries active Pi sessions
    Then the worker process never appears as its own session
    And only metadata-registered session leaders are listed

  Scenario: Pi Sessions App page lists sessions with state, directory, and goals
    Given the user navigates to the Pi Sessions page
    When sessions are loaded from the local agent state
    Then the list shows the sessions the active Session Filter selects, which starts as live only
    And each row shows its Pi state, goal, directory, and activity without raw PID or field label prefixes
    And each row omits secondary modified file badges for a compact view
    And the Session Overview carries the status filter tabs while the Session Detail carries none
    And the page offers no manual refresh control

  Scenario: Pi Sessions live list reflows inside a narrow App page
    Given the user opens Pi Sessions in a narrow portrait window
    When the live session list renders
    Then every row stays inside the App surface without horizontal clipping
    And the page has no filter control to clip

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
    Given multiple sessions are rendered in the Pi Sessions live list
    When viewing the session list on desktop display
    Then rows use compact vertical padding and inline goal alignment
    And multiple running sessions fit within the initial visible viewport

  Scenario: Pi Sessions App formats skill invocation goals as [skill] name
    Given a session goal contains a skill tag
    When the session row is rendered
    Then the skill name is displayed with a bracketed skill indicator similar to the default TUI style
    And raw skill XML tags are omitted

  Scenario: Pi Sessions App displays active model activity
    Given an active Pi session is running
    When the session row is rendered
    Then the row displays the model activity as supporting text without a label
    And running rows display Working... instead of uppercase WORKING
    And goal and activity are distinguished by typography rather than labels

Scenario: Linux shell reads a bounded stream of session events on demand
  Given a session's own message log is far larger than the read bound
  When the shell reads that session's events
  Then only a bounded tail of the log is read
  And at most the bounded number of most recent events is returned
  And the events stay in chronological order

Scenario: Session events bound their bodies by kind
  Given a session log contains user prompts, thinking, tool calls, assistant replies, and tool results
  When the shell reads that session's events
  Then every event keeps its own lines rather than one flattened line
  And a prompt stays within 8 KiB, a thought and a tool call within 4 KiB
  And an assistant reply stays within 16 KiB and a tool result within 64 KiB
  And every event names its kind
  And a shortened body is marked truncated rather than silently cut
  And no event is unbounded

Scenario: Session events ignore entries that are not session messages
  Given a session log contains session, model change, thinking level, and custom entries
  When the shell reads that session's events
  Then those entries produce no event

Scenario: An unreadable session log is refused instead of reported empty
  Given a session has no readable message log
  When the shell reads that session's events
  Then the read reports that no events are available
  And it does not report an empty successful stream

Scenario: The session scan stays lightweight
  Given the Pi widget, the status indicator, and the Session Overview read the scan result
  When the shell scans sessions
  Then the scan result carries no session events
  And session events are read only for a selected session on demand
