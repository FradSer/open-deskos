Feature: Independent instrument refinement
  Each display instrument preserves its established visual hierarchy.

  Scenario: Sequential verification remains in the recurring end-to-end gate
    Given the runtime end-to-end gate is run
    When its subprocess checks execute
    Then sequential instrument and App checks must pass for the gate to pass

  Scenario: Year progress preserves unchanged readings
    Given Year progress displays its rounded percentage and precise meter
    When another tick leaves both displayed values unchanged
    Then neither reading is rewritten
    When the new year starts
    Then the percentage and meter return to zero

  Scenario: Face presence distinguishes absent recognition from an offline camera
    Given the Face Agent is observing but has not recognized the owner
    When it reports no face or an unknown face
    Then the primary reading says "No face" or "Unknown"
    And it does not claim the observation service is offline
    When it reports starting or no frame
    Then the primary reading says "Starting" or "No frame"

  Scenario: Hydra removes an offline plant's live meter
    Given a plant previously reported soil moisture while online
    When that plant goes offline
    Then its soil reading is unavailable and its meter is empty
    When that plant disappears from the snapshot
    Then no watering emphasis remains

  Scenario: Year App shows locally calculated year progress
    Given Year progress is mounted with the shared clock
    When the local year changes
    Then its percentage resets from the end-of-year reading to "0%"
    And its description names the current local year

  Scenario: Catalog search preserves loading and failure states
    Given the built-in view catalog request is pending
    When text is entered in its search field
    Then the status still says "Loading built-in views."
    When the request fails and search text changes
    Then the load error remains visible with Reload available
    And a routed IPC failure displays the public error "endpoint-unavailable"
    When Reload succeeds
    Then the current search filters the recovered catalog

  Scenario: Desktop remains usable during user application catalog failure and recovery
    Given the desktop is visible at compact or widescreen geometry
    When its user application catalog is loading and then fails
    Then loading and unavailable states remain truthful without adding a management page
    When a catalog change notification arrives after recovery
    Then the empty installed catalog returns
    And the page marker retains focus when a separate App closes by Back or Escape

  Scenario: Built-in views explains empty search results
    Given the built-in view catalog has loaded
    When a search matches no view
    Then the status says "No matching built-in views. Clear search to see all views."
    When the search is cleared
    Then the matching views return and the empty status clears
    When the catalog itself is empty
    Then the status says "No built-in views available."

  Scenario: Home instruments show only decision-ready readings
    Given Pi has working, idle, and exited sessions with task details
    When Home renders
    Then the Pi Widget shows working and idle counts without goals or activity
    And task details remain in the Pi Sessions App
    And the Pomodoro ring is centered within its body below its heading and state
    And the heading, state, dial, and readings stay inside their card
    And the Year percentage, context, and meter identify the card without a heading
    And the Pi count, Working capsule, and idle count share the horizontal center
    And each Widget preserves its configured grid span

  Scenario: Overview retains a readable header on narrow screens
    Given the Overview content box cannot fit the weekday and full date on one line
    When Home renders at a narrow supported size
    Then the date wraps inside the Overview without horizontal overflow
    And the weekday and status indicator remain visible

  Scenario: Overview aligns its header by the text baseline
    Given Overview shows a weekday and calendar date
    When its width changes in a supported theme
    Then the weekday and date share a text baseline
    And a red indicator at least 16 pixels wide has at least 8 pixels of clearance
    And refreshing keeps the same indicator footprint

  Scenario: A mounted timer Widget follows a replaced App service
    Given a Widget receives its context through the renderer registry
    When the App publishes a replacement focus reader
    Then the existing Widget reads the replacement service
    And late readings from the previous service cannot overwrite it

  Scenario: Sparse instruments use their content area without an empty middle band
    Given a square Home Widget has only a small set of readings
    When it renders at desktop and handheld sizes
    Then Pi shows one large working count above its Working capsule
    And the idle count appears below the capsule
    And primary numerals and the focus dial use more of their available content area
    And supporting labels stay with their readings
    And Hydra uses larger plant and environment readings within its three-by-one span

  Scenario: Compact reading leaves room for the excerpt
    Given WeRead uses one grid cell with a book cover and author
    When the cell is smaller than 250 pixels
    Then the excerpt has at least three visible lines
    And the source row uses no more than 44 percent of the cell height
    And the book title remains available in full

  Scenario: Instruments separate headings from readings
    Given Pi and Hydra render at desktop and handheld sizes
    When their content fills the configured spans
    Then Pi identifies itself through its accessible App entry without a visible heading
    And Hydra groups plant readings without nested card surfaces


  Scenario: Reading follows Hydra in a three-column three-row area
    Given the default desktop shows Home and Hydra
    When the user moves to the page after Hydra
    Then WeRead occupies three columns and three rows
    And Overview keeps its first Home row

  Scenario: Retired views have no installed entry
    Given Clock, Calendar, and Pre-order are retired
    When the desktop and built-in catalog load
    Then their Widgets, Apps, scripts, styles, and bundled artwork are absent
    And the State Bar still shows local time

  Scenario: Heading icons follow the content
    Given each Widget has its own information hierarchy
    When it renders
    Then Hydra retains its leaf icon
    And other Widget headings do not receive automatic decorative icons

  Scenario: Apple reference hierarchy adapts to the existing instruments
    Given Liquid Glass uses the Apple Weather, Batteries, Home, Stocks, and Books reference
    When Widgets render at desktop and handheld sizes
    Then headings have medium weight and primary text contrast
    And Weather keeps its temperature immediately below the city
    And Year progress leaves clearance around its percentage
    And the Reading card gives its dynamic book cover a larger source slot
    And existing spans, source states, and App entries remain unchanged

  Scenario: The second Apple reference keeps related readings together
    Given Liquid Glass shows Pi status and current weather
    When the card grows from handheld to desktop size
    Then the idle count stays within 12 pixels below the Working capsule
    And the weather glyph appears above its condition and daily range
    And the glyph and condition share their leading edge
    And the temperature and daily range scale within the unchanged density band
    And holding rows retain aligned values and subtle separators

  Scenario: Optional headings keep a stable top position
    Given ChatGPT and Pomodoro have useful visible headings
    When their square Widgets render in every supported theme
    Then each heading follows the card top and leading content inset
    And the reading is centered in the remaining body below the heading
    And Pi has no visible heading or empty header space
    And the Pi App entry retains its accessible name

  Scenario: Density follows the requested heading structure
    Given Pi Sessions has no visible title and groups its count, capsule, and Idle count
    When the standard unavailable fixture is measured across supported Cells
    Then its density profile describes the narrow heading-free envelope
    And its occupied floor follows the multi-row contract and its empty-band limit remains unchanged
    And Pomodoro and provider allowance use the standard envelope band with anchored headings
    And retired Clock, Calendar, and Pre-order remain absent while Year and Pomodoro remain available

  Scenario: Shared harnesses enforce each Widget heading contract
    Given default and independent Pi surfaces share the current visual contract
    When Widget harnesses run across four themes and supported compact Cells
    Then Pi has no visible heading and retains its accessible App name
    And ChatGPT and Pomodoro headings follow the top and leading inset
    And their primary readings center below the heading without overlap
    And a title regression fails the shared gate
