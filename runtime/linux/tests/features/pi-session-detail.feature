Feature: Pi Sessions single-session instrument with a Remote session switcher

  Scenario: Pi Sessions title row carries only the title
    Given the shell is on the Pi Sessions page
    Then the title row shows the Pi Sessions heading and no other control
    And no session search field, Refresh control, metric pill, workspace-grouping toggle, status filter group, or data-source label exists on the page

  Scenario: The page shows one session at a time
    Given the Session Set contains several running sessions
    When the Pi Sessions page renders
    Then exactly one Session Detail is shown
    And it identifies the selected session by workspace, status, elapsed time, and goal
    And it reports the position within the Session Set

  Scenario: Session Detail streams the session's operating events
    Given the selected session has a readable message log
    When its Session Detail renders
    Then it lists recent Session Events in order
    And each event is one bounded line
    And no tool result body is rendered

  Scenario: A source without session events says so instead of showing an empty stream
    Given the configured source is Mac over SSH
    When a Session Detail renders
    Then it states that session events are unavailable for that source
    And it does not present an empty successful stream

  Scenario: A session without a readable log says so
    Given the selected session has no readable message log
    When its Session Detail renders
    Then it states that no session log is available
    And it does not present an empty successful stream

  Scenario: Touchpad Select enters App Focus Mode in place
    Given the shell is on the Pi Sessions page in browsing mode
    When the Remote Touchpad sends primary input
    Then the shell enters App Focus Mode
    And the selected page does not change

  Scenario: Horizontal input switches sessions in App Focus Mode
    Given the shell is in App Focus Mode on the Pi Sessions page
    When the Remote Touchpad sends right input
    Then the selection moves to the next member of the Session Set
    And the selected page does not change

  Scenario: Session switching stops at both ends
    Given the selection is the last member of the Session Set
    When the Remote Touchpad sends right input
    Then the selection does not move
    And it does not wrap to the first member

  Scenario: Vertical input scrolls the Session Detail
    Given the shell is in App Focus Mode on the Pi Sessions page
    When the Remote Touchpad sends down input
    Then the Session Detail scrolls
    And the selected page and the selection do not change

  Scenario: Back exits App Focus Mode and closes the Session Overview
    Given the shell is in App Focus Mode on the Pi Sessions page
    And the Session Overview is open
    When the Remote Touchpad sends back input
    Then the Session Overview closes
    And the shell returns to browsing mode on the same page
    And horizontal input again requests bounded paging

  Scenario: Back closes an Overview that was opened from the Remote Control Strip
    Given the shell is browsing the Pi Sessions page
    And the Session Overview was opened from the Remote Control Strip
    When the Remote Touchpad sends back input
    Then the Session Overview closes
    And the selected page does not change

  Scenario: Select inside App Focus Mode opens the Session Overview
    Given the shell is in App Focus Mode on the Pi Sessions page
    When the Remote Touchpad sends primary input
    Then the Session Overview opens

  Scenario: The Remote Control Strip carries two Pi Sessions buttons
    Given the Pi Sessions page is selected
    Then Remote State Feedback declares a Session Filter button and a Session Overview button
    And the page publishes those buttons as its own authoritative state

  Scenario: Another page never inherits the Pi Sessions buttons
    Given the Pi Sessions page published its Remote Control Strip buttons
    When the user selects a different page
    Then Remote State Feedback declares that page's own actions
    And the Pi Sessions buttons are not declared for it

  Scenario: The Session Filter button label is the current filter
    Given the Pi Sessions page is selected and the Session Filter is Working
    Then the Session Filter button label reads WORKING
    When the Session Filter becomes Settled
    Then the same button label reads SETTLED

  Scenario: The Session Filter button advances the filter
    Given the Pi Sessions page is selected and the Session Filter is Working
    When the Session Filter button input arrives
    Then the Session Filter advances to the next filter
    And the Session Switcher, the Session Overview, and the Session Detail use the new set
    And the status-bar count keeps reporting Running Sessions
    And the selected page does not change

  Scenario: Session Overview opens from the Remote Control Strip
    Given the Pi Sessions page is selected
    When the Session Overview button input arrives
    Then the Session Overview covers the page's main area
    And it renders one cell per member of the Session Set

  Scenario: Session Overview identifies the set and the source
    Given a Mac over SSH source is configured
    When the Session Overview opens
    Then it names the Session Set size and the data source
    And the Session Detail does not name the data source

  Scenario: Choosing an Overview cell selects that session
    Given the Session Overview is open with several sessions listed
    When a cell is chosen by pointer, keyboard, or Remote primary input
    Then the Session Overview closes
    And the Session Detail shows the chosen session

  Scenario: Session Overview is the screen-side filter entry
    Given the Session Overview is open
    Then it offers All, Working, Settled, and Exited controls
    And choosing one changes the Session Filter used by the switcher, the grid, and the status-bar count

  Scenario: Session Overview is reachable without the Remote
    Given the Pi Sessions page is selected and no Remote Link is available
    When the user activates the All sessions control in the Session Detail
    Then the Session Overview opens

  Scenario: The default Session Set is the running sessions
    Given the shell has just started on the Pi Sessions page
    Then the Session Filter is Working
    And the Session Set contains only Running Sessions

  Scenario: Selection survives a refresh by session identity
    Given a session is selected
    When a scan returns a reordered Session Set
    Then the same session stays selected
    And a newly started session does not take the selection

  Scenario: A finished session hands the selection to a neighbour
    Given a session is selected and another member of the Session Set is still running
    When the selected session ends
    Then a surviving member of the Session Set becomes selected

  Scenario: An empty Session Set is stated honestly
    Given no session matches the Session Filter
    When the Pi Sessions page renders
    Then it states that no session matches
    And it does not present a fabricated session

  Scenario: An unavailable source is named and never guessed
    Given the configured source is unavailable
    When the Pi Sessions page renders
    Then it names the data source as unavailable
    And it does not instruct the user to press a Refresh control
    And a later automatic poll may restore the sessions

  Scenario: A historical session is readable but not controllable
    Given the Session Filter is Settled
    When a settled session is selected
    Then its Session Detail shows its identity and its events
    And no control for changing or stopping it is offered

  Scenario: The Session Filter is transient
    Given the Session Filter was changed away from Working
    When the shell restarts
    Then the Session Filter is Working