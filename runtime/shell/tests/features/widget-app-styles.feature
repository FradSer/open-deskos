Feature: Legible Widget and App interiors

  Scenario: Frames distinguish readings from interactive Apps
    Given Home has read-only Widgets and each App opens into its own interactive view
    When the desk renders in Instrument, Pixel, or Border Beam
    Then Widgets have a static one-pixel neutral border without gaining controls
    And an App view shares their border width, border colour, and radius
    When an App takes focus or receives a pointer press
    Then its frame keeps that size, colour, and radius, and the focused control carries its own outline
    And leaving the App restores the desk

  Scenario: Every Widget retains readable content in a compact window
    Given the shell displays every Home, Desk, and Reading Widget
    When the window is 320 by 480, 480 by 854, 960 by 640, or zoomed to 200 percent
    Then each Widget keeps a square readable surface with at least 12 pixel supporting text
    And all Widget text wraps inside its surface without overlap or clipping
    And the Home page scrolls vertically when the complete grid cannot fit
    And Up and Down keyboard input keeps Home selected and scrolls the focused grid
    And no Widget gains an interactive control
    And the Desk status icon, readiness label, resolution, and context form a centered vertical group

  Scenario: App content uses the available compact width
    Given the shell displays Pi Sessions or the AI usage App
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
    When the AI usage App renders
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
    Given the compact AI usage App is scrollable and a control inside it is focused
    When the user presses ArrowDown and then ArrowUp
    Then neither keyboard event is cancelled by the shell
    And the App scrolls down and back up using native browser behavior
    And the App remains open after each key

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
    When Home, Pi Sessions, or the AI usage App is displayed
    Then the five-column three-row Widget layout retains its existing footprint
    And the direct App surfaces match that footprint
    And the existing token palette, truthful states, and navigation behavior are preserved

  Scenario: Every instrument uses the same reading hierarchy
    Given the desktop contains nine display Widgets and retains Clock and Calendar
    When each Widget renders in any supported theme at reference or handheld size
    Then each redesigned Widget uses the shared readable caption role
    And the heading precedes its primary reading without overlap
    And inactive frames use the neutral surface and stroke
    And source states remain text rather than interactive badges
    And opening the Widget retains its existing App and return path
    And Reading retains its original excerpt and book details without a separate heading

  Scenario: Desk instruments use quiet tonal surfaces
    Given the Instrument theme displays the desktop Widgets
    When the user reads the Home instruments
    Then the Widget surface is one neutral tone above the desktop ground
    And headings remain at least 16 pixels at reference and handheld sizes
    And primary figures use regular text weight with tabular digits
    And the Pi heading, count, and task share one left edge
    And status colors remain on data rather than the Widget frame

  Scenario: Glass clipping keeps the shared rounded frame
    Given the glass SDK applies its clip path and resets the inline corner radius
    When the Widget uses the Liquid Glass theme
    Then its visible frame keeps the shared App corner radius
    And no square frame surrounds the rounded glass surface

  Scenario: Garden moisture leads environmental context
    Given Hydra receives two plant readings and four environment readings
    When the Widget has a wide Cell
    Then both plant moisture percentages lead the instrument
    And the four environmental values remain visible below them
    And every value keeps its source state and unit

  Scenario: Usage reads its source when first mounted
    Given AI usage has not retrieved a source snapshot
    When its Widget mounts
    Then it requests the shared reading without waiting for a minute tick
    And a late completion cannot write after release

  Scenario: The harness checks every registered Widget in a shared three-by-three grid
    Given the Shell preview uses isolated synthetic readings
    When the Widget grid harness renders each supported theme and panel size
    Then each harness page has exactly three columns and three rows
    And each registered Widget occupies one unique Cell within those nine positions
    And additional Widgets use another three-by-three harness page
    And every Widget keeps its content and App entry inside its Cell
    And the original desktop placement remains unchanged
