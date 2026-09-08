Feature: Legible Widget and App interiors

  Scenario: Every Widget retains readable content in a compact window
    Given the shell displays all ten Home Widgets
    When the window is 320 by 480, 480 by 854, 960 by 640, or zoomed to 200 percent
    Then each Widget keeps a square readable surface with at least 12 pixel supporting text
    And all Widget text wraps inside its surface without overlap or clipping
    And the Home page scrolls vertically when the complete grid cannot fit
    And Up and Down keyboard input keeps Home selected and scrolls the focused grid
    And no Widget gains an interactive control
    And the Desk status icon, readiness label, resolution, and context form a centered vertical group

  Scenario: App content uses the available compact width
    Given the shell displays Pi Sessions or Usage
    When the window is narrower than the desktop grid
    Then the App uses the available width within the page margins
    And every filter, refresh action, and search field is at least 44 pixels high
    And filter labels remain on a single line
    And overflow content scrolls inside the App without making its heading or actions unreachable
    And focusing an action scrolls it into the visible App area

  Scenario: Pi Sessions retains complete long content
    Given the scanner returns a long workspace path, session identifier, goal, command, and modified file path
    When the Pi Sessions App renders and the file disclosure is expanded
    Then those values wrap without horizontal overflow or truncation
    And metadata and placeholders meet a 4.5 to 1 text contrast ratio
    And search has a persistent visible label
    And the status filter has a named group
    And useful App text remains selectable

  Scenario: Usage distinguishes numbers from status prose
    Given the provider returns either usage metrics or an unavailable state
    When Usage renders
    Then each metric keeps its visible label
    And percentages are prominent tabular numerals
    And reset instructions and the empty-state explanation use readable body typography
    And the refresh and help actions remain reachable by touch and keyboard

  Scenario: Pi Sessions announces unavailable and failed refreshes
    Given the scanner becomes unavailable or rejects a refresh
    When the user selects Refresh
    Then the same recovery instruction appears visually and in the stable polite status region
    And the instruction names Refresh as the next action

  Scenario: App controls respect input states
    Given the user operates a direct App page or a built-in App view
    When a control receives keyboard focus
    Then it has a visible focus indicator at least 2 pixels wide
    When reduced motion is requested
    Then filters, disclosures, search fields, and action buttons have no transitions or press scaling
    And a disabled action keeps a distinct static treatment

  Scenario: Vertical keyboard input scrolls Home in both directions
    Given Home is selected in a 320 by 480 window with its scroll position at the top
    When the user presses ArrowDown and then ArrowUp
    Then Home scrolls down and returns to its original position
    And Home remains selected after each key

  Scenario: Editable App controls keep their native arrow behavior
    Given the Pi Sessions search field is focused with a value and caret position
    When the user presses ArrowUp, ArrowDown, ArrowLeft, or ArrowRight
    Then the shell does not cancel the keyboard event or change the selected page
    And horizontal arrows move the caret without changing the field value

  Scenario: App surfaces keep native vertical keyboard scrolling
    Given the compact Usage App is scrollable and a control inside it is focused
    When the user presses ArrowDown and then ArrowUp
    Then neither keyboard event is cancelled by the shell
    And the App scrolls down and back up using native browser behavior
    And Usage remains selected after each key

  Scenario: Remote Touchpad vertical input stays separate from keyboard scrolling
    Given Home is selected and scrolled partway down
    When the Remote Touchpad sends up and down through the preload input channel
    Then Home remains selected at its original scroll position
    Given Pi Sessions is selected in App browsing mode
    When the Remote Touchpad sends up and down
    Then the App retains its selected page, scroll position, and focused control
    When the Remote Touchpad sends primary followed by up
    Then App Focus Mode moves focus between App controls without changing pages

  Scenario: Page indicators have distinct pointer targets
    Given the shell is displayed in a compact or desktop window
    When the user selects the center or upper edge of a page indicator
    Then that indicator receives the pointer rather than its neighbor
    And all four indicators stay between the status information without overlapping

  Scenario: Desktop geometry remains stable
    Given the shell is 1920 by 1280 or 1920 by 1080
    When Home, Pi Sessions, or Usage is displayed
    Then the five-column three-row Widget layout retains its existing footprint
    And the direct App surfaces match that footprint
    And the existing token palette, truthful states, and navigation behavior are preserved
