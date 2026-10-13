Feature: Personal Agent home briefing
  Scenario: Home follows Widget and App state
    Given Open DeskOS Data exposes current Widget and App readings
    When Personal Agent starts or a reading changes
    Then it generates a bounded home briefing from those readings
    And each statement identifies its source and measurement state
    And the home does not substitute fixed session-count sentences

  Scenario: Source changes during generation
    Given a briefing generation is in progress
    When a source publishes a newer reading
    Then the previous generation cannot publish as current
    And Personal Agent generates from the newer readings

  Scenario: Optional services fail
    Given the agent or a source is unavailable, empty, stale, or malformed
    When the home renders
    Then it states the actual briefing availability
    And retained statements are marked stale
    And touch, keyboard, Widgets, and Apps remain usable

  Scenario: Content from a future mail App
    Given a mail App publishes content through Open DeskOS Data
    When its reading changes
    Then that content can inform the home briefing without a mail-specific home path
    And source content grants no tool, memory, or action authority

  Scenario: Bounded accessible text
    Given a briefing contains long English, Chinese, or HTML-like text
    When the home renders in any supported theme or compact size
    Then the text wraps and remains literal
    And meaningful availability changes use a stable status region

  Scenario: Home reads as a short sentence with inline icons
    Given current Widget and App readings
    When Personal Agent writes the home briefing
    Then it returns at most two connected sentences with at most 240 characters
    And contextual words connect icon-labelled facts in reading order
    And the renderer shows one paragraph with muted context and bright facts
    And source states and measurement times remain available in a disclosure
    And only approved icons can be rendered

  Scenario: Source disclosure accepts pointer input
    Given the home shows a generated briefing
    When the user clicks Sources
    Then its source details open without starting a page swipe

  Scenario: Restrained source color and changing readings
    Given the home contains temperature and Pi session facts
    When their current readings change
    Then Personal Agent receives the new values and regenerates the sentence
    And live fact icons use restrained source color while text stays neutral
    And retained facts lose live color during refresh or failure

  Scenario: Plugins declare home coverage
    Given Futu declares required holdings and another plugin declares hidden data
    When Personal Agent generates the home
    Then it must include Futu holdings or their actual unavailable state
    And hidden readings do not enter generation
    And optional readings follow declared priority and fields

  Scenario: Compact temperature units
    Given a temperature fact uses degrees Celsius
    When the home renders in Pixel
    Then its unit stays compact without a full pixel cell between the degree and C

  Scenario: Required source name survives model correction
    Given a generated sentence omits a required plugin name
    When Personal Agent corrects the response
    Then the correction includes the exact required name, icon, and source identifier

  Scenario: Futu shows only its daily percentage
    Given Futu publishes a daily percentage change
    When Personal Agent generates the home
    Then Futu contributes only its signed daily percentage
    And live gains and losses use restrained directional color
    And zero and retained percentages use neutral color

  Scenario: Weekday and date share a visual center
    Given the home header has room for the weekday and date
    When the home renders in a supported theme
    Then the weekday and date align vertically at their centers

  Scenario: Source color extends beyond gain and loss
    Given live weather, Pi sessions, and plant facts
    When the home renders
    Then their icons use distinct restrained semantic colors
    And portfolio icons use a muted green beside directional percentages
    And retained source icons keep their category colors

  Scenario: Home accents avoid blue
    Given live weather and Pi session facts
    When the home renders
    Then weather uses a muted warm gold icon
    And Pi sessions use a muted rose icon
    And no source accent uses blue

  Scenario: Plugin values bind independently of generated layout
    Given Personal Agent generates a template with plugin field references
    When temperature, session counts, or daily percentage change
    Then the host binds current plugin values into the same template
    And no second model generation is needed for a value change
    And literal generated numbers and unknown field references are rejected
    And a source availability change requires a matching template

  Scenario: Weather label and Pixel Celsius remain readable
    Given a live weather fact on the home
    When the fact wraps in a supported theme
    Then Weather stays complete beside its icon
    And the Pixel theme uses a square degree mark and pixel C
    And the temperature keeps its unit without extra spacing

  Scenario: Home uses available width and stable source icon colors
    Given a home paragraph with weather, Pi sessions, and an unavailable portfolio
    When the home renders or retains its previous reading
    Then the paragraph uses the full content width
    And source icons retain distinct restrained colors
    And unavailable and retained values keep explicit state text

  Scenario: Released Dashboard callbacks cannot change a later placement
    Given Dashboard subscribes to briefing updates and the shared Tick
    When its placement releases and the same container mounts again
    Then callbacks captured from the released placement cannot change either placement
    And the current placement still accepts briefing and date updates
    And failed unsubscribe retains cleanup ownership until retry

  Scenario: An independent Dashboard preserves briefing behavior during runtime replacement
    Given Today displays literal briefing segments and source provenance
    When a development or signed independent Dashboard replaces the default page
    Then the same page container displays equivalent values and source states
    And Instrument, Pixel, and Border Beam retain equivalent rendered content
    And date updates and Sources disclosure remain available
    And the foreground App stays mounted and Back returns to the same selected page
    And built-in recovery preserves the document and neighboring placements

  Scenario: Dashboard compatibility rejects changed state text
    Given an independent Dashboard loads through the development or signed installation path
    When its empty briefing message differs from the current product behavior
    Then the rendered comparison fails at the changed message
    And fixture cleanup releases the selected implementation before profile removal

  Scenario: Authenticated Dashboard activation preserves the complete Main composition
    Given production Main enables every plugin with private state and controlled external inputs
    And the Shell starts with a built-in or signed Dashboard
    And the actual Bot client has no external transport during injected briefing comparisons
    When the CLI activates signed Dashboard revisions and restores the built-in page
    Then the same Today container renders compatible briefings in all three themes
    And briefing and Tick subscription counts remain stable
    And the foreground App, selected page, and peer ports remain unchanged
    And recovery works with malformed configuration and revoked publisher trust
    And shutdown releases subscriptions, handlers, protocol routes, and private listeners

  Scenario: Production Dashboard acceptance rejects missing briefing ownership
    Given a signed Dashboard candidate omits its briefing subscription
    When the authenticated activation path selects the candidate
    Then the subscription ownership assertion fails after activation
    And the fixture closes before its private profile is removed

  Scenario: Hidden Dashboard comparisons retain declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture prepares its comparison document
    Then its renderer viewport is 1920 by 1280 at unit scale before measurement
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And briefing, placement, pointer, release, recovery, and deadline assertions remain required

  Scenario: Agent and briefing stay beside paged Widgets
    Given the Shell has current desk readings and a Personal Bot session
    When the user changes a Widget page by touch or keyboard
    Then the Agent stays on the left and the briefing stays above the Widgets
    And only the bottom page dots change
    And the date stays on the same line as the weekday
    And display-only Widgets have no outer card border

  Scenario: Text and voice share the resident conversation
    Given Personal Bot is available
    When the user sends text or records a spoken request
    Then the resident session streams its reply into one conversation scroll area
    And the composer stays at the bottom
    And the configured name and icon identify the header, replies, and composer
    And unavailable or uncertain delivery keeps the draft with an explicit error
    And typing arrow keys does not change the Widget page

  Scenario: State Bar distinguishes missing evidence
    Given a peripheral source has not reported its state
    When the State Bar renders
    Then it shows Unknown rather than Disconnected
    And unavailable and disconnected sources have distinct text
    And network reachability does not claim a confirmed Wi-Fi connection

  Scenario: A streaming turn survives transport recovery
    Given the resident Agent has a partial response
    When the service becomes unavailable and resumes the same response
    Then the conversation keeps one user message and one response
    And a completed turn permits the same question in a new turn

  Scenario: A late text receipt preserves the final service state
    Given a typed request completes before its receipt arrives
    When the receipt confirms delivery
    Then the Agent keeps the completed response and Ready state

  Scenario: The resident microphone stops and starts voice turns
    Given the Agent is recording a voice request
    When the user selects Stop recording
    Then the Shell invokes the existing recording control once
    And the next microphone action can start another voice turn

  Scenario: App account values remain readable beside the Agent
    Given the Agent occupies the left side of a compact desk
    When the user opens the Usage page on the right
    Then account values have a font size of at least 14 pixels
    And all account details remain reachable by scrolling

  Scenario: A long Agent name leaves room for conversation
    Given the Agent name contains 40 CJK characters
    When the desk is 320 pixels wide in a supported theme
    Then the name wraps without hiding the composer
    And the conversation retains a usable scroll area

  Scenario: A connected gamepad stays visible in the compact State Bar
    Given a gamepad is connected
    When the desk is 320 pixels wide
    Then the presence icon stays inside the State Bar
    And Pi status retains space beside the icon

  Scenario: Agent recovery feedback remains readable
    Given a Personal Bot request fails
    When the resident Agent shows recovery feedback
    Then the feedback uses at least 14 pixel text
    And its live status region announces the available recovery action

  Scenario: Home retains the established State Bar design
    Given the resident Agent is beside the previous Overview
    When the Shell renders in a supported theme
    Then the State Bar retains its original height, icon scale, Pi capsule, and clock typography
    And peripheral availability remains identifiable without a row of device descriptions

  Scenario: The right grid shows more instruments without oversized hero tiles
    Given Overview stays above the Widget pages
    When the right pane changes width
    Then the grid derives its columns and square unit size from that pane
    And the right side has three columns and three rows
    And Overview spans the three columns in the first row
    And the target panel shows six home Widgets in the remaining two rows
    And each Widget unit remains square and at least 200 pixels on the target panel
    And Pi sessions and Pomodoro each use one square unit
    And Hydra retains two rows for its plant readings on the next page
    And compact pages keep all Widgets reachable without horizontal overflow
    And Pixel Pi readings stay inside a compact square when the summary is visible

  Scenario: Home omits the separate time and date Widgets
    Given the right side keeps Overview above a three-column two-row Widget grid
    When Home renders
    Then no page contains the clock or almanac Widget
    And the State Bar time and Overview date remain visible
    And existing portfolio and camera Widgets fill the released Home cells

  Scenario: The resident Agent leaves more room for a tightly fitted grid
    Given the desk has room for a three-column two-row Widget grid
    When Home renders or the window changes size in a supported theme
    Then the Agent occupies at most 35 percent of the wide desk
    And square Widget units use the available width and height
    And the last Widget row leaves one outer margin above pagination with integer-cell rounding
    And Widget gaps and outer vertical margins are 12 pixels
    And Overview stays above the grid and the composer stays reachable
