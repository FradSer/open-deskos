Feature: Personal Agent home briefing

  Scenario: Pi verification metadata cannot replace a useful report
    Given Pi reports include task names, content, and verification metadata
    When Overview selects facts or recovers from a generation failure
    Then verification metadata remains available for analysis
    And verification metadata cannot appear as a separate Overview fact
    And report content keeps its reported attribution without raw verification codes
    And terminal task states retain their verification qualifiers

  Scenario: Generation status stays inside the Overview indicator
    Given Overview can retain current source-bound readings
    When generation fails or current state cannot be confirmed
    Then the existing spinner shows a static failure mark
    And its accessible label explains automatic recovery
    And the paragraph contains no generation error text
    And an empty failure leaves the paragraph empty
    And replacing or restoring the service retains the indicator status
    And the Markdown content container retains its accessible status role

  Scenario: Each service supplies at most one Overview fact
    Given Pi supplies session fields and several remote reports
    And resident Agent tasks share their own service
    When all facts participate in selection or recovery
    Then only the first selected fact from each service is displayed
    And declared producer readings pass through the single data registry
    And different services with the same icon remain independent
    And ignored duplicate facts cannot fail generation or enter later selection rounds
    And a selected analysis-only fact receives the bounded format correction
    And that correction lists only displayable choices with their original selectors

  Scenario: Overview supports safe Markdown
    Given a selected source contains emphasis, lists, code, and links
    When Overview renders the source-bound text
    Then Markdown uses local semantic styling in each theme
    And HTML remains literal and images cannot load
    And links remain display-only text
    And temperatures and signed percentages retain their formatting

  Scenario: All connected sources can inform Overview
    Given more than 64 visible data sources with different declared priorities
    When Overview reads current desk information
    Then every visible source participates in bounded batches
    And no source has a reserved display position
    And one failed source does not exclude healthy sources

  Scenario: Pi Agent activity informs the same selection
    Given Pi sessions expose goals, activity, and waiting states
    And resident agents expose running tasks and completion verification
    When an agent waits, fails, or reports a result
    Then Overview evaluates that change with all other current facts
    And reported completion does not establish verified completion

  Scenario: A real model evaluates the complete Overview inventory
    Given an explicitly authorized live provider and isolated agent state
    When the live verifier supplies more than 64 sources and Agent state changes
    Then every source fact reaches a tool-free model session
    And failed, waiting, and running Agent tasks can enter Overview
    And connected device readings pass the same selection and binding checks
    And the verifier records source coverage separately from synthetic scenarios
    And compact inventories use one request within the input byte budget
    And independent batches run concurrently within the shared deadline

  Scenario: Overview selection bounds provider reasoning
    Given the configured Model Studio model enables thinking by default
    When Overview starts an isolated selection
    Then its provider request disables thinking and bounds output tokens
    And virtual model defaults retain a positive output bound
    And the resident Agent keeps its original model configuration

  Scenario: Busy Pi activity does not starve Overview
    Given a model selection is pending while Pi activity changes
    When the selection completes
    Then selected facts bind to current activity and verification qualifiers
    And changed selection context schedules another selection
    And removed facts and hidden sources cannot remain displayed
    And reordered sessions retain their selected task identities

  Scenario: Fresh facts survive generation failure
    Given Overview has an earlier generated summary
    And current source values have changed
    When summary generation fails
    Then Overview can show current source-bound facts with an error state
    And it does not restore a fixed portfolio, weather, and Pi combination
  Scenario: Conversation history mounts in bounded batches
    Given the resident snapshot contains remote updates, owner turns, and session replies
    When the conversation opens
    Then only the latest twelve timeline items create message nodes
    And older items remain data until the user scrolls upward or uses Home at the top
    When an earlier batch is added
    Then the previously visible message keeps its screen position
    And existing message nodes and the unsent draft remain unchanged
    And thread selection, exact reply references, and live messages remain usable
    And a deferred reply follows its exact source when the canonical thread changes
    And later snapshots retain already received owner turns and replies within their existing 128-entry bounds
    And an expired reply keeps a shared message while its owner turn still retains it
    And new live turns expire old owner pairs without duplicate or orphan message nodes
    And a received legacy remote update without a timestamp can enter the latest batch
    And the composer stays outside the single scroll region
    And loading history sends no task request or model request

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

  Scenario: The Agent capsule keeps the name clear above its status
    Given the Agent uses its default name and is idle
    When the capsule renders at desktop or compact widths
    Then the complete default name stays on one line
    And the name stays on the horizontal center of the capsule
    And the visible name and status group stays on the vertical center
    And the capsule keeps a touch target of at least 44 pixels
    When a long name or status is displayed
    Then the name truncates inside the capsule without wrapping
    And the status truncates below the name inside the same capsule without moving the conversation
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

  Scenario: Home preserves the saved name in a read-only capsule
    Given the Agent has a previously saved name
    When the Agent panel renders
    Then the title displays the saved name without changing the stored identity
    And the capsule has no arrow or identity editor
    And the capsule has no pointer or keyboard editing interaction

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
    Then Markdown wraps and HTML-like text remains literal
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

  Scenario: Plugins declare fields without reserved home positions
    Given Futu declares legacy required metadata and another plugin declares hidden data
    When Personal Agent generates the home
    Then current facts compete without category or priority slots
    And hidden readings do not enter generation
    And all other readings participate through their declared fields

  Scenario: Compact temperature units
    Given a temperature fact uses degrees Celsius
    When the home renders in Pixel
    Then its unit stays compact without a full pixel cell between the degree and C

  Scenario: Model correction preserves fact identity
    Given a generated selection contains an unknown or repeated fact selector
    When Personal Agent corrects the response
    Then the correction uses only the captured fact catalog
    And no source gains a mandatory position

  Scenario: Futu shows only its daily percentage
    Given Futu publishes a daily percentage change
    When Personal Agent generates the home
    Then a selected Futu fact contributes only its signed daily percentage
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
    And ordinary numeric changes need no second model generation
    And meaningful activity and availability changes require selection again
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
    Given Today displays safe Markdown briefing segments and truthful availability
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
    Then the Agent keeps the completed response and quiet idle header

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
    And the scroll fixture extends beyond the near-latest threshold
    When the left pane renders in a supported theme
    Then one avatar is centered above a compact name and status capsule
    And the capsule is a read-only group with no arrow or identity editor
    And assistant replies use rounded bubbles without repeated avatars
    And the composer stays below the single conversation scroll region
    And scrolling earlier messages preserves the composer position
    And Jump to latest restores the newest message
    And Jump to latest overlays the conversation without moving messages or the composer
    And scroll controls are checked after the native scroll event settles
    And messages and the scroll track fade into the top edge of the conversation
    And the fade leaves the avatar and capsule visible and the composer interactive
    And forced colors keep the conversation unmasked
    And the native scrollbar is transparent until scrolling and fades after scrolling stops
    And reduced motion hides the idle scrollbar without a fade
    And narrow windows and long names retain usable input and recovery text
    And the interface does not add the reference image sample questions

  Scenario: Long service errors keep the Agent capsule compact
    Given the resident service reports a long suggestions error
    When the Agent shows its status
    Then the capsule shows a short unavailable caption
    And its accessible name contains the visible Agent name and status
    And the capsule has no disclosure, edit form, or keyboard stop

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
  And task labels identify the work while exact references remain in the service
  And coverage metadata stays outside the conversation while connection failures remain visible
  And incoming reports do not submit owner messages

Scenario: Personal Agent reports completed tasks as short conversation messages
  Given the resident retains legacy task reports and new assistant updates
  When the conversation receives or reconnects to those messages
  Then each new update appears once in its original order as an assistant bubble
  And source identifiers and audit labels stay outside the conversation
  And legacy reports remain complete in the same message timeline
  And unavailable task connections use a short header status
  And the existing conversation is the only scroll region above the fixed composer
  And keyboard focus and the current reading position survive repeated frames

Scenario: Personal Agent keeps provider diagnostics out of the conversation
  Given the resident model is ready with optional Jev disabled or unavailable
  When the Agent receives status changes or reconnects
  Then the ready header shows no status caption or provider labels
  And optional provider failures do not create warnings or conversation messages
  And an actual readiness failure remains visible without claiming authentication passed
  And the single scroll region and fixed composer remain usable

Scenario: Overview refresh uses the weekday indicator without adding chat text
  Given Overview shows a red presence dot beside its weekday
  When the existing briefing state becomes loading
  Then that same indicator shows a spinner in the same position
  And successful generation restores the red dot
  And failed generation shows a static failure mark inside the same indicator
  And loading preserves the previous briefing text without adding refresh narration
  And an initial load uses the empty placeholder with an accessible busy state
  And automatic refresh preserves all conversation text and message nodes
  And explicit owner questions and completed task messages remain available
  And reduced motion keeps a static busy indicator and accessible busy state

Scenario: A calm conversation keeps provenance outside the message timeline
  Given the Agent receives completed updates and durable owner replies
  When the conversation opens with a ready model
  Then natural message text and one explicit Reply action are the primary content
  And session identifiers, source references, verification and successful receipts stay outside the message timeline
  And an update with several sessions requires an explicit source choice before replying
  And uncertain or failed delivery remains visible with a useful next step
  And unavailable connections remain visible without repeated provider metadata
  And running subagent identities and avatars remain visible
  And task names, reply references and the fixed composer remain keyboard and touch accessible
  And repeated frames preserve the same messages, focus and reading position
  And the compact composer uses a short placeholder with an identity-specific accessible label

Scenario: AI-selected session replies retain the original owner turn
  Given an ordinary owner turn has a host-generated execution identity
  When the host binds that execution to a durable session reply with the same identity
  Then the conversation reuses its original owner and assistant message nodes
  And the answer belongs to the selected session thread without matching historical text
  And delivery status remains independent from the assistant answer
  And a fresh mount with a combined owner and durable reply snapshot creates no duplicate messages
  And legacy origin history stays before its replayed owner reply without inventing timestamps

Scenario: Both displays show the same central conversation history
  Given the central Agent publishes bounded owner turns with stable identities
  When a display connects, reconnects, or reopens the conversation
  Then each owner turn and answer appears once in chronological order
  And an exact owner identity shares existing durable session reply nodes
  And a historical snapshot cannot replace newer live text or the current draft
  And an interrupted turn remains explicitly unconfirmed without claiming completion
  And malformed or older history frames cannot replace the retained history

Scenario: Conversation type adapts to the available Agent pane
  Given the same conversation appears in reference and compact panes
  When its pane width changes independently from the host platform
  Then primary conversation text remains at least 20 pixels and grows within its readable range
  And composer input remains at least 20 pixels without clipping its short placeholder
  And long CJK text wraps inside the single conversation scroller
  And the fixed composer and 44-pixel controls remain visible in each supported theme

Scenario: A compact desk gives Overview a full readable row
  Given the desk is 480 or 320 pixels wide and stacks below the conversation
  When its Widget grid uses a single readable column
  Then Overview uses the available row without changing Widget sizes
  And the full date and weekday retain their shared text baseline
  And the full month in September 30, 2026 stays readable without clipping
  And compact Widget pages reserve only the scrollbar space that they use
  And the presence dot and refresh spinner retain their footprint
  And the desktop Overview stays aligned with its three-column Widget grid

Scenario: Hidden previews capture the current native viewport
  Given an offscreen preview has valid layout before its native surface is ready
  When the harness captures the viewport or a scrollbar crop
  Then it first requires a nonempty native frame with the full viewport size
  And it reads current compositor pixels with the original capture rectangle
  And paint failures stop within a deadline without retries

  Scenario: The Personal Agent conversation shows messages and task names
    Given retained owner turns and remote Pi task updates
    When the Personal Agent is ready
    Then its header shows no Ready caption or status dot
    And messages have concise descriptive task names below their text
    And task names open the exact task thread and preserve explicit reply selection
    And task names use one small icon and gray text without a border, fill, shadow, or capsule
    And each single-task reference and its Reply button share a vertical center
    And single-task and multiple-task messages use the same two-column task row
    And each task row has exactly one Reply button and one task label
    And task labels retain their plain text treatment when hovered, pressed, or shown in Liquid Glass
    And a one-character task name retains a 44-pixel pointer target
    And task labels retain readable text and keyboard focus in high-contrast modes
    And long task names wrap without horizontal conversation overflow
    And no Sources, Conversation details, or Earlier messages disclosures appear
    And scrolling up loads retained messages without a history button
    When the agent processes a request
    Then the header shows Thinking with an accessible status
    And uncertain delivery and connection failures remain visible

  Scenario: An interrupted composition check cannot report success
    Given a private Electron fixture has a transient profile cleanup conflict
    When the composition runner collects its child result
    Then cleanup retries within a fixed bound
    And a remaining runner error exits unsuccessfully with its original diagnostic

  Scenario: Durable reply task labels use the complete retained source identity
    Given two retained messages share an ID and have different source keys and revisions
    When a durable reply references the second source
    Then its task label uses the second source name
    And an ambiguous complete source reference remains unavailable

  Scenario: Keyboard history loading adds an earlier batch
    Given the conversation has deferred history and keyboard focus
    When the user presses Home
    Then another batch mounts without replacing existing nodes
    And the draft and viewport anchor remain unchanged

  Scenario: Onee animates the complete Personal Agent interaction
    Given the local Onee definition and animation engine are available
    When input starts, voice records, transcription runs, and a reply streams
    Then Onee shows preparing, listening, thinking, working, and replying animations from actual states
    And a completed response gets one finite reaction before idle resumes
    And errors and unavailable transport have distinct animations
    And refused input cannot celebrate an earlier answer
    And completion follows observed work for the same service turn
    And new task reports get one reaction without replaying retained reports
    And the thinking phase uses its own thinking animation before public output arrives
    And a streaming reply uses the replying animation and Replying caption together
    And a running child uses the working animation and Working caption together
    And repeated status frames do not restart an unchanged animation
    And input never waits for an animation to finish
    And the composer does not duplicate the animated avatar
    And reduced motion shows the matching static pose with readable status
    And hidden documents pause playback and released pages stop all animation work
    And the engine loads locally under the unchanged content security policy

  Scenario: Agent identity floats above the conversation
    Given the resident Agent has a Onee avatar and an identity capsule
    When the conversation scrolls in any supported theme or panel size
    Then the capsule overlaps only the lower fifth of the avatar
    And the avatar paints above the capsule while its name stays below the overlap
    And the visible avatar starts near the top of the conversation scroll track
    And the avatar frame removes unused SVG padding without shrinking or clipping animation
    And the header has no opaque background or backdrop blur
    And messages scroll behind the header and receive input outside the capsule
    And selected task navigation passes message input outside its readable return button
    And the name and visible status group stay centered in the capsule
    And the capsule has no arrow, editing action, or keyboard stop
    And the composer retains keyboard and pointer access

  Scenario: The capsule acknowledges a status change once
    Given the Agent name and status share one capsule
    When the service status changes
    Then the status appears below the name with one short capsule animation
    And an unchanged status does not restart that animation
    And hidden documents, reduced motion, and released pages stop capsule animation
