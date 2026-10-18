Feature: Personal Agent home briefing
  Scenario: Actual child execution reaches the conversation through the resident channel
    Given an isolated resident uses Durable execution with an offline provider
    And a saved reporter has a book avatar
    When the user submits a task through the composer
    Then the service socket and Shell client deliver the running identity to the conversation
    And interrupted transport shows unavailable activity until the channel recovers
    And cancellation and completion remove inactive activity
    And a resident restart preserves the saved identity for another task

  Scenario: Running saved children have identities in the conversation
    Given the resident reports saved child tasks with built-in avatars
    When a child starts, runs, or receives cancellation
    Then the conversation shows its saved name, avatar, and actual state
    And the composer remains outside the single conversation scroll region
    And long names wrap in narrow windows and large text
    And unavailable transport cannot leave an old task labelled Running
    And released status callbacks cannot change the conversation

  Scenario: The Agent identity capsule stays on one line
    Given the Agent uses its default name and Ready status
    When the capsule renders at desktop or compact widths
    Then the complete default name stays on one line
    And the capsule keeps its 44 pixel control height
    When a long name or status is displayed
    Then each label truncates inside the capsule without wrapping
    And the accessible name retains the complete Agent name and status

  Scenario: Text input focus follows the composer capsule
    Given the resident Agent composer is visible in a supported theme
    When the user focuses its text input with the keyboard or pointer
    Then a visible focus outline follows the outer composer shape
    And the text input has no separate rectangular outline
    And the microphone and send buttons retain their own keyboard focus indicators

  Scenario: Overview copy fits inside the established card
    Given Overview has a fixed grid-row footprint
    When briefing length or the available copy area changes
    Then only briefing text and inline icons resize together
    And weekday, date, card geometry, and Widget placement stay unchanged
    And copy fits within the remaining area above its readable floor
    And longer content remains reachable at that floor

  Scenario: Home hides the identity editing entry
    Given the Agent has a saved name and icon
    When the Agent panel renders
    Then the title has no visible or focusable pencil entry
    And saved identity data and editing logic remain intact

  Scenario: Conversation uses separate spaced message bubbles
    Given the Agent has a name and a conversation with replies
    When replies stream, notifications arrive, or the identity changes
    Then the name appears visually only in the panel heading
    And each Agent reply has a background container
    And each independent notification has its own message container
    And consecutive messages have a visible 20 pixel gap
    And the heading and input icons stay synchronized with the accessible identity
    And conversation messages have no avatars or timestamps
    And streaming updates preserve the message containers

  Scenario: Normal design previews contain consistent populated readings
    Given an isolated preview uses synthetic desk data
    When the preview captures a supported theme
    Then every Home Widget shows representative content
    And Overview facts agree with the Widget readings
    And Camera uses a decoded synthetic frame without hardware capture
    And a fixture-only Pomodoro reading is identified as simulated
    And the complete timer reading stays centered with space inside its dial
    And the Agent shows one representative conversation
    And failure scenarios remain separate from normal preview captures

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
    And source states still govern truthful facts and availability
    And only approved icons can be rendered

  Scenario: Overview has no attribution metadata or source controls
    Given the home shows a generated briefing
    When Overview renders in a supported theme
    Then it has no Personal Agent attribution or update timestamp
    And it has no Sources disclosure or focusable source controls
    And the briefing paragraph announces availability changes

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
    Given Today displays literal briefing segments and truthful availability
    When a development or signed independent Dashboard replaces the default page
    Then the same page container displays equivalent values and source states
    And Instrument, Pixel, and Border Beam retain equivalent rendered content
    And date updates and briefing availability remain available
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
    Then the Agent stays on the left and the briefing moves with the first Widget page
    And only the bottom page dots change
    And the date stays on the same line as the weekday
    And display-only Widgets have a subtle outer border

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
    When the user opens the AI usage App from its Home Widget
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
    And the reference panel shows six home Widgets in the remaining two rows
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
    Then the Agent uses the width left by the fitted square canvas
    And square Widget units use the available width and height
    And the reference panel leaves one outer margin above pagination with integer-cell rounding
    And Widget gaps and outer vertical margins are 16 pixels
    And Overview stays above the grid and the composer stays reachable

  Scenario: Overview and Widgets share one three-column canvas
    Given the reference panel has room for three square columns and two Widget rows
    When Home renders in Instrument, Pixel, or Border Beam
    Then Overview spans the same left and right edges as the Widget grid
    And Overview and Widgets use the largest three-row square canvas that fits the pane
    And Overview occupies one square unit of height across all three columns
    And six complete Widgets and pagination remain visible on the reference panel
    And handheld panels fit all six Widgets without vertical canvas scrolling
    And every handheld Widget remains square and uses its compact composition
    And intermediate pane widths reduce columns before violating that floor
    And paging moves Overview with Home so later pages do not display it

  Scenario: Overview is the first card of Home
    Given Home has a three-column three-row canvas
    When the user swipes or selects the next page
    Then Overview moves by the same distance as the Home Widgets
    And only Home contains the Overview card
    And returning to Home preserves briefing content without source controls
    And Overview has no border and keeps one grid-row height

  Scenario: The conversation uses spare width beside a square canvas
    Given Home has a three-column three-row canvas
    When a wide window has more width than the square canvas needs
    Then the Personal Agent grows instead of adding empty bands beside Widgets
    And the Widget canvas keeps 32 pixel horizontal margins in wide windows
    And compact windows keep 20 pixel horizontal canvas margins
    And every one-by-one Widget stays square in all three themes
    And Overview stays borderless and moves only with Home

  Scenario: The resident conversation follows the reference layout
    Given the Agent has real conversation messages
    When the left pane renders in a supported theme
    Then one avatar is centered above a compact name and status capsule
    And the capsule opens the existing identity form with keyboard or pointer input
    And assistant replies use rounded bubbles without repeated avatars
    And the composer stays below the single conversation scroll region
    And scrolling earlier messages preserves the composer position
    And Jump to latest restores the newest message
    And narrow windows and long names retain usable input and recovery text
    And the open identity editor and Save button remain inside the Agent pane
    And the interface does not add the reference image sample questions

  Scenario: Long service errors keep the Agent capsule compact
    Given the resident service reports a long suggestions error
    When the Agent shows its status
    Then the capsule shows a short unavailable caption
    And its accessible name contains the visible Agent name and status
    When the user opens the capsule
    Then the complete status is readable in the contained editor
    And keyboard navigation reveals Save without scrolling the desk

  Scenario: Hidden Agent layout comparisons use settled viewport dimensions
    Given the Agent fixture uses a private offscreen window
    When it changes viewport or theme
    Then Chromium reports the requested viewport at unit scale
    And layout measurements wait for the matching grid, fonts, and frames
    And the original State Bar and interaction assertions remain required

Scenario: Remote Pi synthesis stays in the same Agent conversation
  Given the reviewed remote conversation capability has retained synthesized Pi reports
  When the Agent page opens or receives an updated service frame
  Then the existing conversation shows each retained synthesis once
  And source disclosures identify the machine and exact session without granting controls
  And partial, stale, and unavailable remote coverage remains visible
  And incoming reports do not submit owner messages

Scenario: Personal Agent reports remote progress as short conversation messages
  Given the resident retains legacy task reports and new assistant updates
  When the conversation receives or reconnects to those messages
  Then each new update appears once in its original order as an assistant bubble
  And source identifiers and audit labels stay inside a closed Sources disclosure
  And legacy reports remain complete in one closed Earlier task updates group
  And partial or unavailable coverage uses a short readable status
  And the existing conversation is the only scroll region above the fixed composer
  And keyboard focus and the current reading position survive repeated frames
