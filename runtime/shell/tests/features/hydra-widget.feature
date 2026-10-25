Feature: Hydra plant and environment Widget on the Desk page

  The Desk page carries a Hydra Widget fed by the Hydra MQTT bridge
  (Mosquitto on the NAS). It shows the two caladium watering nodes
  (soil moisture, pump state, online state) and the main node's
  environment sensors (temperature, humidity, pressure, lux).

  Scenario: Hydra runtime browser replacement preserves rendered consumers without navigation
    Given authenticated discovery exposes a trusted independent Hydra entry while the Shell is running
    When the browser loads that entry and the runtime controller replaces the surface
    Then the original desktop container and document remain mounted without navigation
    And the selected independent mount cannot delegate to the default implementation
    And all 288 theme, Cell, and source-state consumers retain attributes, computed CSS, text, and geometry
    When the controller restores the captured default definition
    Then all 288 consumers remain equal and default mounting executes again
    And discovery shutdown releases IPC and captured signed assets

  Scenario: Trusted runtime replacement drains signed Hydra source ownership
    Given the Native loader captures an independent signed Hydra source
    And production source, IPC, Open DeskOS Data, and cached health plugins run in one Host
    When a trusted controller replaces that factory with another captured signed revision
    Then the previous MQTT completion callback blocks new client construction
    And late old messages cannot change fresh readings
    And both revisions and restored default preserve public consumer values
    And stored signed bytes remain unchanged

  Scenario: Actual Main jointly starts signed Hydra source and surface
    Given signed independent Hydra source and surface selections share one publisher policy
    And a controlled loopback MQTT broker publishes canonical plant and environment messages
    When actual Main starts each updated, rolled-back, and removed surface selection in a separate process
    Then the signed source executes without constructing the default source
    And actual preload data reaches the selected rendered Hydra Widget
    And rendered readings and plant states remain equal across all four launches
    And shutdown releases source, discovery, protocol, and broker connections
    And source selection and all stored revisions remain unchanged

  Scenario: Joint Hydra startup waits for the measured wide Cell
    Given the joint Main fixture uses its 1920 by 1280 desktop
    When telemetry arrives before the first Cell resize callback
    Then the fixture waits for wide Cell geometry and the wide composition
    And complete rendered comparisons remain unchanged across surface revisions

  Scenario: Signed Hydra surface revisions preserve separate process consumers
    Given signed source and surface selections share one external publisher policy
    When the Native CLI updates, rolls back, and removes the surface selection
    Then each selection executes in a different Electron process
    And selected and executed surface revisions agree
    And the complete rendered matrix remains equal across processes
    And invalid updates retain configuration bytes and unrelated preferences
    And removal restores the default surface while retaining source and stored surface revisions

  Scenario: Signed Hydra surfaces execute captured verified entries
    Given the Native CLI installs an independent Hydra surface with explicit publisher policy and trust
    When Renderer discovery captures its verified entry before browser loading
    And the stored entry changes after capture
    Then actual preload consumers retain the default rendered matrix
    And another store verification rejects the changed entry
    And shutdown releases discovery IPC and signed asset routes

  Scenario: Hydra state badges stay inside the narrow tall Cell
    Given the Hydra Widget occupies its minimum tall Cell of 120 by 240 pixels
    When the source reports waiting, offline, stale, or unconfigured state
    Then the complete badge stays inside the Cell without lowering its readable floor
    And environment readings and plant rows remain contained

  Scenario: An unconfigured compact plant Cell keeps its full state visible
    Given Hydra occupies its narrowest plant Cell of 116 by 120 pixels
    And the bridge is unconfigured
    When the Widget renders in each theme
    Then the complete unconfigured state stays inside the Cell
    And both plant placeholders and the omission count remain contained
    And supporting text retains its 12-pixel readable floor
    And the instrument name remains available to assistive technology
    And the visible-content collector does not count a clipped hidden title

  Scenario: Trusted Hydra development surfaces preserve actual rendered consumers
    Given the CLI links an independent Hydra surface with explicit trust
    When actual Renderer discovery loads its entry before Shell composition
    Then actual preload supplies controlled snapshots to the selected surface
    And default and independent surfaces retain readings, effective classes, fonts, and geometry
    And all three themes preserve twelve measured Cell compositions
    And surface release clears mounted resources and shutdown removes discovery IPC

  Scenario: Independent Hydra surfaces preserve readings and resource behavior
    Given default and independent Hydra surfaces share static layout and stylesheet assets
    When source states, plant telemetry, ticks, and measured cells change
    Then both selected factories preserve labels, units, meters, badges, and omission counts
    And both retain tall, compact, plants-only, and too-small compositions
    And the independent surface never calls the default mount
    And each mount owns its observer, subscriptions, and late response guards

  Scenario: Released Hydra surfaces cannot change new mounts
    Given a Hydra Widget has pending source requests and resize callbacks
    When the Renderer releases the Widget and mounts it again
    Then old request success or failure cannot change the new readings
    And old ticks cannot start source requests
    And old resize callbacks cannot change shape or plant labels
    And failed observer release remains owned and retryable
    And the shared Main source remains available to other consumers

  Scenario: Packaged Hydra bridge loads its MQTT dependency graph
    Given the CM5 release uses pnpm isolated node modules
    When the Hydra source loads MQTT after a previous connection attempt
    Then it does not delete transitive MQTT modules from Node's module cache
    And the source can reconnect without reporting a missing mqtt-packet module

  Scenario: Unconfigured Hydra bridge stays honest
    Given no Hydra MQTT broker URL is configured
    When the Desk page renders
    Then the Hydra widget says the bridge is unconfigured
    And no soil moisture, pump state, or environment reading is fabricated

  Scenario: Hydra widget shows live plant and environment status
    Given the Hydra MQTT bridge is configured and connected
    And node 1 reports soil 62 percent with the pump idle and online
    And node 2 reports soil 48 percent while watering and online
    And the main node reports temperature, humidity, pressure and lux
    When the Hydra widget refreshes
    Then both plant rows show their soil percentage and watering state
    And the watering plant states its condition in words beside its moisture rail
    And a wide Cell renders four secondary tabular environment readings in one row
    And two plant readings sit side by side below the environment, separated by the shared stroke
    And every moisture rail draws its fill on a visible track
    And the live badge renders as a quiet outlined live-state pill
    And the widget states a live data status

  Scenario: Live MQTT state changes refresh the widget
    Given the Hydra MQTT bridge is configured and connected
    And retained node readings populated the Hydra widget
    When node 1 enters the automatic pulse watering state
    And node 2 enters the idle state after a retained legacy pump flag said watering
    And the main node heartbeat expires
    Then node 1 is shown as watering without waiting for the legacy pump flag
    And node 2 is shown as idle because the current status is authoritative
    And the widget no longer presents the retained readings as live

  Scenario: Invalid or offline readings stay truthful
    Given the Hydra MQTT bridge is configured and connected
    When node 1 publishes an invalid soil reading
    And node 2 publishes offline
    Then node 1 shows the soil reading as unavailable
    And node 2 is marked offline without fabricating moisture

  Scenario: Retained plant readings cannot look live after telemetry stops
    Given retained soil and status readings populated both plant rows
    When the main node is offline or a plant has not refreshed within the freshness window
    Then the affected plant is marked stale
    And its last known soil value remains visible only as historical data
    And the snapshot exposes message timestamps for monitoring

  Scenario: A new dashboard connection does not refresh retained data age
    Given the broker holds an old online heartbeat, environment snapshot, and plant readings
    When Open DeskOS reconnects and receives those retained MQTT messages
    Then the retained values remain available as historical data
    But the main node, environment, and plant rows stay stale until a live publication arrives

  Scenario: Main-node diagnostics identify the running device image
    Given the Hydra main node publishes its retained diagnostic topics
    When Open DeskOS reads the Hydra snapshot
    Then the snapshot includes firmware, build, boot, reset reason, uptime, and last successful publication
    And a new boot identity replaces the prior boot diagnostics
    And diagnostic values never override plant or environment readings

  Scenario: Invalid environment summary clears the old retained readings
    Given the Hydra MQTT bridge is configured and connected
    And a retained environment summary populated the Hydra widget
    When the main node publishes an invalid environment summary
    And retained legacy environment topics arrive afterward
    Then the old environment readings are cleared
    And the legacy topics cannot repopulate the invalid atomic snapshot
    And the widget never keeps presenting them as live

  Scenario: Silent environment data dims instead of vanishing
    Given the Hydra MQTT bridge is configured and connected
    And the main node stopped publishing environment readings
    When the Hydra widget refreshes after the environment staleness window
    Then the widget marks the environment data as stale
    And it keeps showing the last known readings dimmed under the stale badge
    And it never presents the stale readings as live

  Scenario: Environment summary topic hydrates the widget
    Given the Hydra MQTT bridge is configured and connected
    And the main node publishes the retained environment summary
    When the Hydra widget refreshes
    Then the environment section shows the summary temperature, humidity, pressure and lux
    And the widget states a live data status

  Scenario: Plant rows carry a soil moisture meter
    Given the Hydra MQTT bridge is configured and connected
    And node 1 reports soil 62 percent and node 2 reports soil 44 percent
    When the Hydra widget refreshes
    Then each plant row shows a soil meter bar filled to its reported percentage
    And a plant below the dry threshold shows its meter in the dry color

  Scenario: Hydra keeps its three-by-one Desk card
    Given the Desk page uses a three-by-three grid
    When the desktop composer places Hydra
    Then Hydra spans columns 1 to 4 and one row
    And both plants and all four environment readings remain visible
    And Home retains its six separate Widgets
    And the Hydra Widget opens the existing Hydra App

  Scenario: A wide Cell shows the new environment and plant composition
    Given Hydra occupies a Cell at least 480 pixels wide and 300 pixels high
    When the Cell can hold the wide instrument
    Then four environment readings form four columns and one row
    And both plants appear side by side above the environment
    And the header, plants, and environment have gaps between 12 and 20 pixels
    And the desktop card fits its content with a minimum wide height of 300 pixels
    And spare Cell height does not stretch gaps inside the card
    And every reading retains its unit and complete state
    And the current theme remains selected

  Scenario: A smaller Cell preserves the readable fallback
    Given the Desk canvas cannot honor the full Hydra span
    When the composer gives Hydra a smaller measured Cell
    Then Hydra selects its existing tall, compact, plants-only, or too-small shape
    And no reading overlaps or leaves its Cell
    And every theme selects the same shape for the same Cell

  Scenario: A shape that leaves readings out says how many
    Given the Hydra widget is drawn in a cell too small for the environment readings
    Then the environment readings are left out as whole readings rather than truncated
    And the widget states in its own text how many readings it is not showing
    And no reading is drawn below the readable floor

  Scenario: Soil updates animate without changing meter layout
    Given a plant reports soil moisture at 62 percent
    When its reading changes or the plant goes offline
    Then the meter scales from its left edge to match the displayed reading
    And its layout width stays equal to the track width
    And reduced motion disables the meter transition
    And the watering texture follows the semantic primary color of the active theme

  Scenario: Signed source activation preserves actual Main and preload consumers
    Given actual Main runs a signed Hydra source with an isolated loopback MQTT broker
    When the operator selects another signed revision and activates it through the actual CLI
    Then the same Main process replaces the source through its authenticated control channel
    And actual preload returns the same telemetry after each activation
    And source health remains healthy after fresh telemetry
    And activation preserves the selected configuration bytes
    And normal shutdown releases the control listener and source handlers
  Scenario: Static replacement comparison suppresses motion under the production policy
    Given the actual Shell document retains its restrictive style policy
    When the acceptance fixture compares default and independent Hydra surfaces
    Then its static measurement stylesheet applies before sampling
    And meter transitions and animations are disabled for both implementations
    And the fixture removes its stylesheet after the comparison

  Scenario: Replacement comparison uses the same rendering scale
    Given a launch request specifies a different device scale
    When it compares default, independent, and restored Hydra surfaces
    Then it uses the same fixed device scale and page zoom before each measurement
    And it rejects measurements if either input changes
    And its geometry, style, font, and containment assertions remain unchanged

  Scenario: Cross-process revision checks retain the rendering fixture budget
    Given CM5 uses the existing 150-second Hydra rendering fixture budget
    When acceptance starts each of the four revision comparison processes
    Then each child watchdog allows the fixture to finish and release resources
    And the parent budget covers all four children and setup
    And other hosts retain their existing budgets

  Scenario: Wide Pixel panels use the larger environment reading
    Given a tall Hydra panel has at least 280 pixels of content width
    And the panel uses the Shell display-only Widget frame under home-desk
    And the frame contributes one pixel on each edge
    When the Pixel theme renders its environment readings
    Then the readings use the larger 40-pixel size
    And 338-pixel and 334-pixel Cells with 28-pixel insets have 280-pixel and 276-pixel content widths
    And the narrower panel retains its 32-pixel limit without clipping

  Scenario: Runtime replacement budgets cover the restored rendering phase
    Given CM5 compares default, independent, and restored Hydra rendering
    When it runs the full comparison matrix
    Then the fixture allows 225 seconds for its three phases
    And child and parent watchdogs leave bounded cleanup time
    And ordinary two-phase comparisons retain their 150-second fixture budget
    And other hosts retain their existing budgets

  Scenario: Complete style comparisons avoid nested cross-process objects
    Given Hydra captures every computed style property and its exact value
    When the renderer sends a comparison snapshot
    Then it sends a canonical lossless string for each computed style
    And property order does not change equality
    And changed, added, or removed properties still fail equality
    And the full cell, theme, state, and lifecycle matrix remains unchanged

  Scenario: Independent CM5 surface modes use bounded parallel workers
    Given each Hydra surface mode owns its configuration and Electron process
    When CM5 runs the independent surface comparison modes
    Then at most two modes run at the same time
    And each mode keeps its watchdog, cancellation, matrix, and cleanup
    And revision updates and rollback remain serial
    And other hosts retain one worker

  Scenario: A tall assigned wide Cell keeps its instrument grouped
    Given Hydra receives a wide Cell at 1103 by 730 pixels
    When each supported theme renders live telemetry
    Then two plant readings and all four environment readings remain visible
    And the groups use bounded gaps instead of stretching to the Cell edges
    And the unchanged strict density profile passes

  Scenario: A full soil reading adapts without changing telemetry
    Given a plant reports 100 percent moisture
    When the wide instrument renders the reading
    Then the complete value fits inside its plant panel
    And a later two-digit or unavailable reading clears the width adjustment
    And stale and offline states retain their existing meanings

  Scenario: Native font metrics preserve the wide instrument density
    Given the wide Hydra instrument renders with each host's native theme fonts
    When Windows and macOS render normal and full moisture readings
    Then the original strict density limits pass on both hosts
    And the three-column strip and Pixel reading scale remain unchanged

  Scenario: Shared frame changes preserve the reading threshold checks
    Given each theme has a Shell-owned one-pixel frame and 28-pixel padding on each side
    When the fixture supplies outer Cell widths of 338, 337, and 334 pixels
    Then the measured content lanes are 280, 279, and 276 pixels in each theme
    And Pixel environment readings use 40, 32, and 32 pixels respectively
