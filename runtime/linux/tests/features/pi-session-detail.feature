Feature: Pi Sessions live session list with a Remote session reader

  Scenario: The Session Detail carries no page title or controls
    Given a session is shown in the Session Detail
    Then the page has one view heading and that heading is the session's Pi state
    And no filter tabs and no session controls exist inside the Session Detail
    And the Session Detail states session facts without offering a control

  Scenario: The Session Filter lives in the Session Overview
    Given the shell is on the Pi Sessions page
    When the Session Overview renders
    Then it carries a status tab for Live, Working, Idle, Exited, and All in that order
    And each tab shows how many sessions it selects
    And the Live tab is the active tab
    And the Session Detail carries no tab

  Scenario: The Remote Control Strip carries one Pi Sessions button
    Given the Pi Sessions page is selected
    Then the page publishes one Session Filter button whose label is the current filter
    And Remote State Feedback declares that button with items focus
    And pressing it advances the Session Filter and relabels the button
    And the Remote's persistent Back and Select remain the rest of its interface

  Scenario: The live session list is the page's landing view
    Given the shell is on the Pi Sessions page
    When the page renders
    Then the live session list covers the page's main area
    And no Session Detail is shown yet
    And the Live tab selects every session whose status is running or settled
    And an exited session is listed only when the Exited or All tab is active

  Scenario: The Session Filter narrows the Session Overview
    Given the Session Overview lists running, idle, and exited sessions
    When the Working tab is chosen
    Then only running sessions are listed
    And the subtitle names the filtered set and the source
    When the Exited tab is chosen
    Then history is listed without changing the shell page
    When the Live tab is chosen
    Then the started sessions are listed again

  Scenario: A filter with no matching session is stated honestly
    Given no session matches the active Session Filter
    When the Session Overview renders
    Then it states that no session matches that filter
    And it does not present a fabricated session

  Scenario: Choosing a row shows that session
    Given the live session list lists several live sessions
    When a row is chosen by pointer, keyboard, or Remote primary input
    Then the live session list closes
    And the Session Detail shows the chosen session
    And it identifies the session by state, directory, elapsed time, and goal

  Scenario: Back and primary return from a session to the live list
    Given the Session Detail is showing a session
    When Back or primary input arrives
    Then the live session list is shown again
    And the shell stays on the Pi Sessions page

  Scenario: Touchpad Select enters App Focus Mode in place
    Given the shell is on the Pi Sessions page in browsing mode
    When the Remote Touchpad sends primary input
    Then the shell enters App Focus Mode on the live list
    And the selected page does not change

  Scenario: The Session Detail title is the Pi state, directory, and elapsed label
    Given a running session is shown
    Then the title reads "Working..." with the native braille spinner
    And the subtitle is the session's full directory path
    And the elapsed label sits at the right of the title row
    When a settled session is shown
    Then the title reads "Idle" without a spinner

  Scenario: Horizontal input switches sessions in App Focus Mode
    Given the shell is in App Focus Mode with one session shown
    When the Remote Touchpad sends right input
    Then the selection moves to the next live session
    And the selected page does not change
    And the selection does not wrap past the last live session

  Scenario: Vertical input scrolls a settled Session Detail
    Given the shell is in App Focus Mode on a settled Pi session
    When the Remote Touchpad sends down input
    Then the Session Detail scrolls
    And the selected page and the selection do not change

  Scenario: Keyboard navigation stays within the focused session surface
    Given keyboard focus is in the Session Detail
    When the user presses ArrowRight
    Then the next live session is selected without changing the shell page
    And ArrowUp and ArrowDown still scroll the Session Detail

  Scenario: Every event keeps the body Pi produced
    Given a session log holds a prompt, a thought, a bash command, a reply, and a tool result
    When its Session Detail renders
    Then the events are listed in order
    And each event keeps its own lines rather than a single flattened line
    And each event is bounded by the limit for its kind
    And a shortened body says so explicitly

  Scenario: Session Detail streams the session's operating events
    Given the selected session has a readable message log
    When its Session Detail renders
    Then the prompt, the thought, the bash command, the reply, and the result each keep their own body
    And an assistant body beyond 16 KiB is marked truncated
    And a result body beyond 64 KiB is marked truncated

  Scenario: The user's prompt wraps to its container
    Given a selected session publishes a long user prompt
    When the Session Detail renders it
    Then the prompt wraps to the container the detail gives it
    And it is not held to a fixed 65ch reading measure

  Scenario: Assistant replies render Markdown with Pi's own reading colour
    Given a selected session reports an assistant reply with a heading, a link and inline code
    When its Session Detail renders the reply body
    Then the reply renders as Markdown rather than a plain summary
    And Markdown headings, links, bullet markers, and inline code carry Pi's reading palette
    And the page's own surfaces keep the DESIGN.md semantic tokens

  Scenario: Fenced code and unified diffs carry Pi's syntax colour
    Given a selected session reports a result with a fenced code block and a unified diff
    When its Session Detail renders the result body
    Then the fenced code is highlighted with Pi's syntax colour roles
    And added, removed, context, and hunk diff lines each carry their own colour
    And a plain bulleted list is not mistaken for a diff

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

  Scenario: The live list identifies its size and the data source
    Given a Mac over SSH source is configured
    When the live session list is shown
    Then the title row names the live session count and the data source
    And each row states the session's own identity rather than the source

  Scenario: An empty live set is stated honestly
    Given no session is running or settled
    When the Pi Sessions page renders
    Then it states that no Pi session is running
    And it does not present a fabricated session

  Scenario: An unavailable source is named and never guessed
    Given the configured source is unavailable
    When the Pi Sessions page renders
    Then it names the data source as unavailable
    And it does not instruct the user to press a Refresh control
    And a later automatic poll may restore the sessions

  Scenario: Selection survives a refresh by session identity
    Given a session is selected
    When a scan returns a reordered live session set
    Then the same session stays selected
    And a newly started session does not take the selection

  Scenario: A finished session hands the selection to a neighbour
    Given a session is selected and another live session is still running
    When the selected session ends
    Then a surviving live session becomes selected

  Scenario: The live list distinguishes sessions in the same workspace
    Given two live sessions share a workspace but have different goals
    When the live list renders
    Then both rows show their state, goal, and directory
    And long English and CJK goals wrap without hiding essential text

  Scenario: Refresh preserves the list reading and focus position
    Given the live list is open and a row has keyboard focus
    When an automatic scan updates activity and appends a session
    Then the focused row keeps its identity and DOM focus
    And the list keeps its scroll position
    And choosing that row still selects the intended session

  Scenario: The live list covers rather than removes the Session Detail
    Given a settled session is shown with a reading position in its events
    When the user returns to the live list
    Then the Session Detail remains mounted underneath the page-local list
    And the covered detail's layout and reading are preserved
    When the user closes the list without choosing another session
    Then the same session and reading position remain
    And keyboard focus returns to the Session Detail

  Scenario: The chosen row is revealed below the fold
    Given a later session is chosen through the live list
    When the list is next shown
    Then the chosen row is focused and scrolled into view

  Scenario: Late responses cannot replace the current session's events
    Given a request for one session's events is in progress
    When the selection changes and a newer event request completes
    And the previous event request completes afterwards
    Then only the newly selected session's events are shown

  Scenario: Automatic selection handover never shows the previous session's events
    Given the selected session leaves the live set during a refresh
    When a surviving session is selected automatically and its events are still loading
    Then the previous session's events are removed
    And the detail honestly reports that it is reading the new session's events

  Scenario: Malformed responses and unavailable sources never appear live
    Given the session source returns a malformed response or an unavailable response with old sessions
    When the page refreshes
    Then the source is reported as unavailable and no live session is fabricated
    And returning to the live list remains usable

  Scenario: Running sessions always follow the newest message
    Given the selected session is Working and its event stream overflows
    When its events first load or refresh
    Then the Session Detail is scrolled to the bottom
    And its scrollbar remains visible
    When the user scrolls up while that session is still Working
    Then the Session Detail returns to the newest message

  Scenario: Settled sessions retain manual reading
    Given the selected session is Settled
    When the user scrolls to an older event and the snapshot refreshes
    Then the event reading position is preserved

  Scenario: A settled session is readable but not controllable
    Given a settled session is shown
    Then its Session Detail shows its identity and its events
    And no control for changing or stopping it is offered

  Scenario: Tool results retain Markdown and tables instead of only their first line
    Given a selected session reports a multiline result with a heading, list, code, and table
    When its Session Detail renders
    Then every line within the result safety limit is available
    And Markdown headings, lists, code blocks, and table rows render semantically
    And the tool name is separate from the Markdown body
    And wide tables scroll horizontally inside the detail without overflowing the page
    And inline HTML, scripts, external images, and clickable external links are not activated

  Scenario: Result tables retain horizontal reading and focus on refresh
    Given a settled session has a wide Markdown result table
    And the table has keyboard focus and is scrolled horizontally
    When unchanged events refresh or a new event is appended
    Then the table keeps its keyboard focus and horizontal reading position
    And its arrow input does not navigate the Shell
    And identical tables in different result bodies do not exchange reading state when older events are evicted

  Scenario: Local results do not require a Desk Link service
    Given the selected source is Local and the Desk Link service is unavailable
    When the selected session has a readable result log
    Then the local result body remains available

  Scenario: A local result outside the readable log tail is not an empty successful stream
    Given a result record is larger than the bounded local log tail
    When no complete event fits in the tail
    Then the detail explains the log-tail limit instead of claiming no events were recorded

  Scenario: Oversized bodies are labelled rather than silently truncated
    Given an assistant reply exceeds 16 KiB or a result exceeds 64 KiB of UTF-8 text
    When the bounded body is rendered
    Then an explicit truncation note identifies the safety limit
    And recent event retention stays bounded to 1 MiB per session

  Scenario: A departed Pi page cannot intercept navigation
    Given the Session Detail had keyboard focus
    When Home or End moves to another shell page
    And an arrow key is pressed
    Then navigation belongs to the visible shell page rather than the hidden Pi page

  Scenario: Session Events follow native Pi reading hierarchy within the Shell theme
    Given the selected session has user, thinking, tool, result, and assistant events
    When its Session Detail renders
    Then user messages have a full-width neutral background
    And assistant text stays on the base surface without a card
    And thinking and tool summaries use readable supporting text
    And tool calls read as compact terminal headings rather than table rows
    And result and assistant bodies render as Markdown rather than summaries
    And event kinds remain available to assistive technology without a repeated visible label column
    And the stream is identified as recent session events, not a complete session history
    And no tool success or pending state is invented from its event kind

  Scenario: The live list follows the native Pi session chooser instead of a card dashboard
    Given several live sessions are available
    When the live list renders
    Then sessions appear in a single full-width list with a state line, the goal, the directory, and the activity
    And the selected session has a leading cursor and a neutral selection background
    And touch targets remain at least 44 pixels high
    And Instrument, Pixel, and Border Beam keep their own fonts and semantic colors