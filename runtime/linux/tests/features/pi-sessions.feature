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

  Scenario: The board stays a board when the filter matches nothing
    Given no session matches the active Session Filter
    When the page renders
    Then the lanes that filter selects are still on the board, each stating a count of zero
    And the page states that no session matches the filter
    And choosing another filter removes the lanes that filter does not select

  Scenario: The Session Overview board keeps its lanes in one row at the desk's own width
    Given the Session Overview shows sessions in three Pi states
    When the board renders at 1280 by 776, the size the desk actually shows
    Then the three lanes sit in one row
    And every lane stays wide enough for a readable card
    And no lane is pushed sideways out of the surface
    And the third lane is not moved to a second row, which read as a stacked list rather than a board

  Scenario: The Session Filter sits on the page title's line
    Given the Session Overview is the visible view
    When the page renders
    Then the filter tabs and the page title share one line
    And the tabs' reading line is level with the title's
    And the tabs keep a touch height rather than being shrunk to fit

  Scenario: Pi Sessions App page arranges sessions as a board of state lanes
    Given the user navigates to the Pi Sessions page
    When sessions are loaded from the local agent state
    Then the board shows the states the active Session Filter selects, which starts as live only
    And every state in that set owns one lane, ordered Working, Idle, Exited
    And a lane whose state has no matching session is still on the board, heading its state with a count of zero
    And each lane heading names its state and how many sessions it holds
    And each session is one card inside its lane, showing its Pi state, goal, directory, and activity without raw PID or field label prefixes
    And no card carries secondary modified file badges
    And a card's goal keeps the lines the person wrote, up to four, and states an ellipsis when it has more
    And a card's activity stays a single short line rather than growing with its body
    And the Session Filter is the only control in the title row, and the Session Detail carries none
    And the title row carries no session count, source, or driven-by description under it
    And the page offers no manual refresh control

  Scenario: The Session Overview board shows several sessions at once
    Given the Session Overview lists more than one live session
    When the board renders at the desk width
    Then the lanes sit side by side in one row
    And every card stays inside its own lane's bounds
    And at least six cards are fully inside the page viewport without scrolling the page

  Scenario: Directional input crosses lanes and moves inside one lane
    Given the Session Overview board is the current view in App Focus Mode
    When left or right input arrives
    Then the focus moves to the neighbouring lane's card at the same position
    When up or down input arrives
    Then the focus moves one card inside the current lane
    And focus stops at the lane's first or last card instead of leaving the board

  Scenario: The status filter tabs share the Pi Sessions title row
    Given the user opens the Pi Sessions page
    When the live session list is the current view
    Then the five status filter tabs sit in the page title row at its trailing edge
    And no session count, source, or driven-by description is carried under the title
    And the tabs share that edge without displacing, wrapping or clipping the page title
    And choosing a session hides the tabs and states its elapsed time on the same trailing edge
    And the tabs keep their inset segmented track, 44 pixel targets, and readable labels at every width

  Scenario: The Pi Sessions page states each condition once
    Given the user opens the Pi Sessions page
    When the scan has not answered yet
    Then the title row states that Pi sessions are loading
    And the list shows Pi's own working indicator without repeating that sentence
    When the scan reports its source unavailable
    Then the title row names the source and that it retries automatically
    And the list states no second sentence
    When the scan answers and the active filter matches no session
    Then the list states which filter matched nothing

  Scenario: The Session Detail states the model activity once
    Given a session reports no model activity
    When that session becomes the Session Detail
    Then the title states its Pi state and the detail does not repeat that state
    And a working session still states what it is doing

  Scenario: Pi Sessions widget never claims a scan it has not read
    Given the widget is mounted before its first scan resolves
    Then it shows a neutral pre-scan indicator
    And it claims no workspace, session or Pi state
    When the scan reports its source unavailable
    Then the widget names that source and that it retries automatically

  Scenario: Pi Sessions live list reflows inside a narrow App page
    Given the user opens Pi Sessions in a narrow portrait window
    When the live session list renders
    Then the lanes stack in one column without horizontal clipping
    And every card stays inside the App surface at a readable width
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
    And an idle widget states the freshest live session's goal when Pi reports one instead of only its count

  Scenario: Pi Sessions fullscreen App renders a compact session list
    Given multiple sessions are rendered in the Pi Sessions live list
    When viewing the session list on desktop display
    Then cards use compact vertical padding and inline goal alignment
    And multiple running sessions fit within the initial visible viewport

  Scenario: Pi Sessions App formats skill invocation goals as [skill] name
    Given a session goal contains a skill tag
    When the session row is rendered
    Then the skill name is displayed with a bracketed skill indicator similar to the default TUI style
    And raw skill XML tags are omitted

  Scenario: Pi Sessions App displays active model activity
    Given an active Pi session is running
    When the session card is rendered
    Then the card displays the model activity as supporting text without a label
    And running cards display Working... instead of uppercase WORKING
    And goal and activity are distinguished by typography rather than labels

  Scenario: Pi Sessions App reads a reported goal and latest content as Markdown
    Given a session reports a goal and a latest content line that carry Markdown emphasis and inline code
    When that session's card is rendered
    Then the card shows the emphasis and the inline code as formatting rather than as Markdown syntax
    And the card keeps the words the session reported
    And a reported line without Markdown is rendered unchanged
    And the Session Detail reads that same reported line the same way

  Scenario: Session Overview cards share one fill until a card is the current session
    Given the Session Overview lists more than one session
    When a fine pointer rests on a card that is not the current session
    Then that card keeps the quiet fill of the cards around it
    And the current session's card keeps the only marked edge

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

Scenario: A Markdown table in any message body keeps the stream repainting
  Given a session's events include a Markdown table in a reply that is not a tool result
  When those events reach the Session Detail
  Then that reply keeps its own table
  And a later repaint of the same stream completes instead of stopping at the table
  And the Session Overview still applies the active Session Filter afterwards

Scenario: A running Desk Link session distinguishes missing delivery from an idle Pi
  Given Desk Link reports a session as running
  When no event batch has arrived for that session
  Then Session Detail says that Pi is running but no events have arrived yet
  And it does not say that the session has not reported any events
  And the session goal and directory remain visible
