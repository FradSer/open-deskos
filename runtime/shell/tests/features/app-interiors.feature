Feature: Built-in App interiors

  Scenario: Existing Renderer replacement preserves built-in views
    Given Calendar, Clock, Pomodoro, Year progress, and Built-in views use registered App surfaces
    When independent definitions replace them through the existing Renderer controller
    Then opening each App retains its title, semantic interior, and behavior
    And local date, minute, and year changes retain their existing readings
    And search, unavailable catalog, and Reload retain their existing results
    And Back releases view subscriptions and returns to the same desktop
    And restoring defaults retains the same behavior

  Scenario: Built-in views expose a coherent semantic interior
    Given a user opens a built-in Calendar, Clock, Pomodoro, Year progress, or AI usage view
    Then the App retains its runtime surface
    And its title is inside an App surface header with an App surface heading
    And explanatory copy uses the App detail anatomy
    And truthful live or pending information uses the runtime value or runtime state anatomy
    And Pomodoro provides a countdown timer with interactive controls
    And the AI usage view hosts the shared quota card with its refresh and quota grid

  Scenario: Pomodoro provides interactive timer controls
    Given a user opens the built-in Pomodoro view
    When the App is mounted
    Then it exposes a countdown dial with Start and Pause controls
    And activating Start begins the countdown timer
    And activating Pause pauses the countdown timer

  Scenario: Default and independent Pomodoro sessions retain their public behavior
    Given a default or independent Pomodoro App has a running session
    When the shared Tick advances or the App closes and reopens
    Then its countdown retains the original completion time
    And repeating Start cannot extend that time
    And Start begins a new session after completion without an intervening Tick
    And unsupported actions return false without changing the session
    And closing the view releases its controls and subscription

  Scenario: The resting Pomodoro Widget makes no session-state claim
    Given the Pomodoro App has started a session
    When the user returns to Home
    Then the display-only Widget identifies the App timer
    And its neutral reading does not claim that the session has not started

  Scenario: Built-in view search has a visible accessible label
    Given a user opens Built-in views
    Then the App retains its runtime surface and App surface header
    And the search input has a visible Search built-in views label associated with it
    And the search input and results use the shared App search and App list anatomy
    And loading and error status remain announced to assistive technology

  Scenario: Closed catalog views ignore late responses
    Given Built-in views has a pending catalog request
    When the user closes the App and opens it again
    Then the reopened view uses its own catalog request
    And late success or failure cannot update the closed view
    And retained search and Reload handlers cannot update the closed view

  Scenario: Trusted external entries preserve built-in App views
    Given independent App entries are linked through the development CLI
    When the existing Renderer loader selects Calendar, Clock, Pomodoro, Year progress, and Built-in views
    Then each selected entry executes through the public App platform
    And the same behavior scenarios pass for default, external, and restored views
    And an entry with changed Clock behavior fails the shared comparison
    And shutdown removes the development discovery handler

  Scenario: Signed external entries preserve built-in App views
    Given signed independent App entries are installed through the native CLI with explicit publisher trust
    When the existing verified asset loader selects Calendar, Clock, Pomodoro, Year progress, and Built-in views
    Then the shared behavior and keyboard scenarios pass for default, signed, and restored views
    And a signed entry with changed Clock behavior fails the shared comparison
    And shutdown removes discovery and the signed asset protocol

  Scenario: Built-in replacements preserve pane keyboard behavior
    Given a desktop navigation control has focus
    When the public App platform opens a default, independent, or restored built-in view
    Then Back receives initial focus
    And Tab and Shift-Tab can reach the Agent and State Bar
    And keyboard text input filters Built-in views
    And Enter activates the available Reload button
    And Escape closes the App and restores the original control focus

  Scenario: Signed built-in App revisions preserve behavior
    Given signed Calendar, Clock, Pomodoro, Year progress, and Built-in views entries are selected at version two
    And all App sessions are closed between replacement phases
    When the native CLI updates their selection to version three
    And the existing loader replaces their closed views in the same document
    Then executing entry versions identify version three
    And the shared reading, search, late-response, Back, and keyboard scenarios match the default views
    When the native CLI rolls their selection back to version two
    Then the same scenarios still match
    And each selection operation preserves the other plugin preferences
    And restoring defaults retains the saved signed selections

  Scenario: Production Main preserves selected built-in App consumers
    Given all Main plugins run with controlled external inputs
    When production startup selects signed Calendar, Clock, Pomodoro, Year progress, and Built-in views entries
    Then their public App readings match the default implementation
    And authenticated restoration and activation preserve those readings in the same document
    And Main ports, desktop nodes, and saved selections remain unchanged
    And an incorrect signed Clock reading fails the same consumer check
    And a missing Clock definition fails the default fallback guard
    And shutdown removes Main handlers and the native asset protocol

  Scenario: Selected built-in App controls retain keyboard focus presentation
    Given a default, selected, updated, rolled-back, or restored built-in view is open
    When keyboard navigation focuses Back, catalog search, or Reload
    Then Instrument, Pixel, and Border Beam retain a visible computed focus marker
    And the focused control remains inside the viewport
    And selected views preserve the default focus styles and control dimensions
    And removing the Back focus marker fails the same check

  Scenario: Hidden App view comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture prepares its App document
    Then its renderer viewport is 1920 by 1280 at unit scale before interaction
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And readings, focus, pointer, keyboard, recovery, and deadline assertions remain required

  Scenario: Repeated browser keys retain native event receipts
    Given catalog search contains seven characters
    When the fixture sends seven Backspace key pairs in one batch
    Then every key-up event is observed before the next assertion
    And the native input path clears the search
    And the temporary key observer is removed after the complete batch

  Scenario: Signed App acceptance has a bounded budget for its complete workload
    Given signed acceptance includes five App phases and ten revision commands
    When the signed fixture runs
    Then its complete workflow has a 60 second watchdog
    And its child process has a 65 second deadline
    And its parent test has a 90 second deadline including package preparation
    And other loading modes retain their 30, 35, and 45 second deadlines
    And each readiness check retains its two second deadline
    And each revision command retains its ten second deadline


  Scenario: A negative fixture requires its own failure exit
    Given a controlled invalid replacement reports its expected guard failure
    When its process exits with code one and no signal
    Then the negative fixture can accept that rejection
    When a watchdog or signal terminates that process
    Then the negative fixture refuses the result even if its error text matches

  Scenario: Reading Apps explain recoverable source failures
    Given Weather or WeRead needs setup or authorization
    When its Widget opens the App
    Then the App explains the required source connection or authorization
    And Refresh remains the available recovery action
    And raw source state identifiers do not replace recovery instructions
    And malformed live readings are not presented as current values

  Scenario: Year details use calendar days
    Given the local year includes February 29
    When Year progress renders
    Then its progress meter retains the elapsed local-year ratio
    And completed days and remaining days include leap day
    And the values reset when the new local year starts
