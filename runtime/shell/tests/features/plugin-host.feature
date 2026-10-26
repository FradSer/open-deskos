Feature: Active product components use replaceable plugin contracts
  Scenario: Startup selection preserves Main diagnosis
    Given default and selected Main diagnosis plugins use the existing composition and authenticated transport
    When public and CLI consumers request plugin states and declared health
    Then both implementations preserve runtime identities and exclude private health fields
    And invalid health and asynchronous rejections remain contained
    And unknown identities and state-changing requests remain refused
    And disabled health providers do not refresh or expose stale probes
    And shutdown removes the diagnosis endpoint

  Scenario: Startup selection preserves the Renderer control channel
    Given default and selected control plugins share the existing command policy and authenticated transport
    When the same public and CLI consumers request inventory and runtime changes
    Then both implementations preserve Renderer receipts and saved preferences
    And invalid channel tokens cannot dispatch Renderer commands
    And stopping control releases its endpoint and report listener
    And enabling control restores one listener with a fresh lifetime
    And replies retained from the stopped lifetime cannot certify new requests

  Scenario: Startup selection preserves Renderer discovery
    Given default and selected discovery plugins use the existing Main composition
    When the current main frame requests Renderer entries
    Then both implementations return the same entries
    And unknown windows and child frames cannot read entries
    And invalid entry lists remain unavailable
    When discovery is disabled and enabled
    Then retained handlers refuse requests and the new handlers use a fresh lifetime
    And shutdown releases owned IPC handlers and Native asset leases

  Scenario: Discovery startup failure releases its Native asset lease
    Given a discovery plugin acquires a Native asset lease
    And another owner already registered the Native protocol
    When discovery cannot register its protocol handler
    Then discovery fails without removing the existing handler
    And its acquired lease closes before the failed startup completes
    When IPC registration fails after discovery registers its protocol handler
    Then discovery removes its own handler and closes its lease
    When protocol removal fails during shutdown
    Then discovery retains its lease and refuses further asset requests
    And a later cleanup retry removes the handler before closing the lease

  Scenario: Selected Renderer diagnosis preserves actual Electron consumers
    Given an isolated Electron Shell uses default or selected Renderer diagnosis
    When public and CLI consumers request the mounted Renderer state
    Then both consumers receive the same plugin states
    And disabling diagnosis leaves the document and mounted nodes unchanged
    And enabling diagnosis restores reporting with a fresh provider
    And a missing selected implementation fails the version check
    And shutdown removes the diagnosis listener and endpoint

  Scenario: Isolated Renderer fixtures retain one nonpersistent browser session
    Given Renderer diagnosis and CSS recovery use private fixture profiles
    When their windows load documents or reload a theme
    Then each fixture reuses one nonpersistent session with caching disabled
    And protocol, permission, and network handlers use that session
    And same-process local storage remains available after reload
    And file configuration, signed assets, and actual process exit checks remain active

  Scenario: Startup selection preserves Renderer diagnosis
    Given default and selected diagnosis plugins use the existing Renderer runtime report contract
    When the same public and CLI consumers request Renderer states
    Then reports accept only the requested sender and main frame
    And invalid reports exclude private data
    And request limits and unavailable reasons remain unchanged
    And disabling diagnosis cancels pending probes and removes its listener
    And enabling diagnosis creates a fresh provider without changing Renderer state

  Scenario: Startup selection preserves the plugin management channel
    Given default and selected management plugins use the existing command policy and authenticated transport
    When the same consumers request inventory and runtime enable or disable
    Then lifecycle receipts and saved preferences remain unchanged
    And protected targets and invalid authentication cannot change plugin state
    And disabling management releases its listener without stopping managed plugins
    And enabling management restores the channel with a fresh signal

  Scenario: Runtime Native assets use an explicit read-only live lease
    Given Main explicitly enables runtime Native assets before a Renderer document loads
    And default and selected discovery implementations use the same asset publisher
    When Main publishes another verified capture while discovery remains running
    Then the existing protocol handler can serve its captured bytes without restarting discovery
    And ordinary snapshot leases expose only their original captures
    And live leases cannot publish or remove the owner's captured entries
    And closing one live lease does not close another lease
    And closing the publisher invalidates its live leases
    And shutdown removes discovery IPC and protocol authority
    And stopping discovery preserves publisher-owned captures until the publisher closes

  Scenario: Trusted Renderer entries load into a running registry
    Given authenticated Main discovery exposes trusted browser entries
    When the browser loader receives a runtime request
    Then compatible declarations validate before entry execution and before factory selection
    And incompatible contracts or new stylesheets leave the current composition running
    And concurrent loads collect definitions in request order
    And a rejected load does not prevent a later valid load

  Scenario: Renderer runtime replacement restores retained placements safely
    Given a running Renderer has selected factories and mounted desktop or status surfaces
    When a trusted controller replaces a compatible definition
    Then old surfaces release before factory replacement
    And the new definition mounts in the same container with its original UI context
    And independent factories keep running
    And layout or stylesheet contract changes fail before release
    And an active dependent App refuses replacement until its existing close path completes
    When candidate startup or mounting fails
    Then rollback restores the previous definition only after candidate resources release
    And retained cleanup failures block rollback and remain available for explicit retry
    When shutdown interrupts replacement or replacements queue concurrently
    Then no remount starts after shutdown and each transition completes in request order

  Scenario: Runtime replacement preserves plugin contracts and resource ownership
    Given a running Host has a provider, its declared consumers, and independent plugins
    When a trusted controller replaces the provider with a compatible factory
    Then consumers release before the previous provider
    And the new provider starts before fresh consumers
    And independent plugins and saved enable preferences remain unchanged
    And incompatible contracts fail before cancellation or resource release
    When release fails or shutdown interrupts replacement
    Then no replacement factory starts before retained resources release
    When replacement startup fails and its resources release
    Then the previous factory and consumers return
    And failed replacement cleanup remains owned instead of starting another factory
    When disable and enable requests wait behind replacement release before shutdown
    Then neither queued request can allocate another factory after shutdown starts
    And a later startup applies the final enable preference

  Scenario: Actual Main bootstrap selects independent WeRead revisions
    Given the Native CLI selects a signed independent WeRead source with explicit trust and grants
    And controlled providers supply live, empty, error, and unconfigured results without real credentials
    When separate actual Main processes start installed, updated, rolled-back, and restored default revisions
    Then actual preload preserves each complete highlight response and cached health
    And live cache bytes survive revision changes without another notebook synchronization
    And signed processes never construct the default WeRead source
    And unsigned updates preserve configuration and retained revisions remain verified after removal
    And normal Main shutdown releases the WeRead handler and source

  Scenario: Actual Main bootstrap selects independent Quota revisions
    Given the Native CLI selects a signed independent Quota source with explicit trust and grants
    And a controlled provider supplies available, empty, unauthorized, unavailable, and unconfigured responses
    When separate actual Main processes start installed, updated, rolled-back, and restored default revisions
    Then actual preload preserves each complete provider response
    And signed processes never construct the default Quota source
    And unsigned updates preserve configuration and retained revisions remain verified after removal
    And normal Main shutdown releases the Quota handler and source without external provider access

  Scenario: Actual Main bootstrap selects independent Pi Sessions and Events
    Given the Native CLI selects signed independent Pi Sessions and Events with explicit trust and grants
    And an owned Open DeskOS Link endpoint supplies reported sessions, hosted collisions, and events
    When separate actual Main processes start installed, updated, rolled-back, and restored default revisions
    Then actual preload preserves complete session and event payloads
    And Hosted Pi identities retain precedence over reported sessions
    And signed processes never construct either default Pi source
    And normal Main shutdown releases both IPC handlers and all Open DeskOS Link request connections

  Scenario: Actual Main bootstrap selects independent Hydra revisions
    Given the Native CLI selects a signed independent Hydra source with explicit trust and grants
    And an owned loopback endpoint supplies controlled MQTT measurements through the installed SDK
    When separate actual Main processes start installed, updated, rolled-back, and restored default revisions
    Then actual preload preserves Hydra environment and plant measurements
    And signed processes never construct the default Hydra source
    And cached health performs no ordinary snapshot or reconnect
    And normal Main shutdown releases Hydra IPC and the MQTT connection

  Scenario: Actual Main bootstrap preserves signed Camera consumers
    Given the Native CLI selects a signed independent Camera source with explicit trust and grants
    And a controlled capture provider supplies bytes with JPEG markers or reports unavailable
    When separate actual Main processes start installed, updated, rolled-back, and restored default revisions
    Then actual preload preserves frames, dimensions, timestamps, and unavailable states
    And signed processes never construct the default Camera source

  Scenario: Windows Camera activation uses isolated authenticated channels
    Given Camera acceptance has private Windows state and a unique pipe prefix
    When actual Main and its operator CLI activate and restore Camera surfaces
    Then every discovered channel uses the private pipe prefix
    And the native Windows state paths and authentication token remain selected
    And source selection, rendered readings, and saved preferences remain unchanged
    And shutdown closes the private Renderer control pipe
    And an absent or invalid prefix prevents fixture startup
    And cached health performs no capture
    And normal Main shutdown releases the frame handler and source without live device access

  Scenario: Actual Main bootstrap selects independent Open DeskOS Link revisions
    Given the Native CLI selects a signed independent Open DeskOS Link source with explicit trust and grants
    When separate actual Main processes start installed, updated, rolled-back, and restored default revisions
    Then actual preload preserves Pi session and event results from an owned local reporter endpoint
    And signed processes never construct the default Open DeskOS Link client
    And unsigned updates preserve configuration and removal retains both verified revisions
    And normal Main shutdown releases the sources and owned request connections

  Scenario: Independent Open DeskOS Link replacements preserve shared Pi consumers
    Given default, linked, and signed Open DeskOS Link sources use the declared raw transport
    When consumers request snapshots, machines, hosted sessions, and session events
    Then the wire messages and available or unavailable results remain unchanged
    And Pi Session Events preserves reported events and local fallback
    And source shutdown drains all pending requests before releasing its port
    And cancelling one request leaves independent requests available
    And cancellation after transport completion still suppresses public results
    And no replacement constructs the default client or imports Shell modules
    And owned Unix socket frames preserve CJK events and pending connection closure

  Scenario: Signed Camera revisions preserve source consumers and saved preferences
    Given a signed independent Camera source serves live or unavailable controlled frames
    When the Native CLI updates, rolls back, or removes the selected revision
    Then the running source remains unchanged until complete Host shutdown
    And a new Host executes the selected source revision or restored default
    And IPC frames, cached health, enable state, and unrelated preferences remain unchanged
    And unsigned updates preserve configuration bytes and both signed revisions remain verified after removal

  Scenario: Signed independent Camera preserves shared source consumers
    Given the Native CLI installs an independent Camera bundle with explicit trust and grants
    When the actual loader selects captured code and Main consumers request controlled frames
    Then frame values, health, throttling, failures, cancellation, and restart match the default source
    And the signed source uses the declared capture provider without constructing the default source
    And stored entry changes after discovery cannot change captured execution

  Scenario: Camera implementations use the same declared capture provider
    Given a Camera capability exposes bounded frame capture without constructing its default source
    When default and independent sources consume controlled raw JPEG bytes
    Then each implementation owns frame validation, cached state, throttling, and capture lifetime
    And provider construction performs no capture
    And existing command arguments, dimensions, frame values, and unavailable states remain unchanged

  Scenario: Camera replacement waits for owned captures before releasing its source
    Given default and independent Camera sources have a pending controlled capture
    When the Camera plugin is disabled
    Then shutdown waits for each owned capture to settle
    And capture ownership is registered before provider callbacks can request shutdown
    And late capture success cannot publish a frame or restore healthy state
    And no new capture starts after shutdown begins
    And enable constructs a new source only after the previous capture releases

  Scenario: Production Main bootstrap selects the signed Weather source
    Given an isolated Native CLI installation selects a signed independent Weather source
    When separate actual Main processes start installed, updated, rolled-back, and restored default sources with controlled provider responses
    Then each signed Host executes the selected source without the default constructor
    And actual preload and the existing Weather Widget preserve the default consumer values
    And removal restores the default source on the next actual Main startup
    And unsigned updates preserve configuration while removal retains both verified signed revisions
    And normal application shutdown releases the owned Weather handler before exit

  Scenario: Weather cache survives signed revision changes across Electron processes
    Given the first signed Weather process writes a live provider reading to its persistent cache
    When updated, rolled-back, and default processes start with that cache and an offline provider
    Then each source loads the reading before requesting the provider
    And actual preload and the rendered Widget preserve its place, units, temperature, and daily limits as stale
    And cached health reports degraded while cache bytes remain unchanged
    And the parent retains cache ownership until all child processes close

  Scenario: Weather revision selection survives separate Electron consumers
    Given the Native CLI selects signed Weather revisions in an isolated persistent configuration
    When separate Electron processes consume version two, version three, rollback, and restored default selections
    Then each actual source executes the selected revision through Main composition and preload
    And the complete rendered consumer matrix remains unchanged
    And unsigned updates preserve configuration bytes
    And removal retains both verified signed revisions

  Scenario: Signed Weather preserves the rendered Widget consumer
    Given default and signed independent Weather sources use controlled provider responses
    When the actual Electron preload supplies their readings to the existing Weather Widget
    Then waiting, live, stale, unavailable, unconfigured, and recovery states remain equal
    And the supported themes preserve text, units, condition glyphs, and contained geometry at compact and wide sizes
    And source execution is verified without constructing the default source for a signed selection
    And renderer remounts leave the shared source and IPC handler available

  Scenario: Signed Weather revisions preserve consumer and selection behavior
    Given a signed independent Weather source serves cached or live consumers
    When the Native CLI updates, rolls back, or removes its selection
    Then the running source remains unchanged until complete Host shutdown and new composition
    And the newly composed source executes the selected revision or the restored default
    And IPC, Open DeskOS Data, cached health, cache bytes, and unrelated preferences remain unchanged
    And an unsigned update preserves configuration bytes and the running source
    And removal preserves both verified revisions

  Scenario: Weather source behavior belongs to its selected implementation
    Given default and independent Weather sources receive the same controlled provider and location inputs
    When the existing source scenarios and public consumers run against both implementations
    Then locations, labels, temperatures, cache, states, timeout, concurrent reads, and cancellation remain unchanged
    And the replacement owns request and cache behavior without importing the default Weather source
    And shared device-location and reading helpers remain explicit dependencies

  Scenario: Signed independent Weather preserves source consumers
    Given the Native CLI installs the independent Weather bundle with explicit trust and grants
    When the Host supplies Weather IPC, Open DeskOS Data, and cached health
    Then the signed implementation preserves the shared consumer and cancellation scenarios
    And executed source markers prove selection without the default source constructor
    And changes to stored files after discovery cannot change captured behavior


  Scenario: Signed WeRead revisions preserve consumer and selection behavior
    Given a signed independent WeRead source serves cached or live consumers
    When the Native CLI updates, rolls back, or removes its selection
    Then the running source remains unchanged until complete Host shutdown and new composition
    And the newly composed source executes the selected revision or the restored default
    And IPC, Open DeskOS Data, cached health, cache bytes, and unrelated preferences remain unchanged
    And an unsigned update preserves configuration bytes and the running source
    And removal preserves both verified revisions

  Scenario: WeRead revision selection survives separate Electron consumers
    Given the Native CLI selects signed WeRead revisions in an isolated persistent configuration
    When separate Electron processes consume version two, version three, rollback, and restored default selections
    Then actual Main composition and preload execute the selected source without default fallback
    And three themes and wide and compact layouts preserve the same visible state matrix
    And each child closes and releases its private profile before the next process starts
    And both signed revision stores remain verified after removal

  Scenario: Signed independent WeRead preserves the rendered Widget
    Given default and signed independent WeRead use the same isolated provider and cache inputs
    When the actual preload supplies readings to the mounted Widget
    Then three themes and wide and compact layouts preserve text, metadata, and decoded cover images
    And loading, empty, error, unconfigured, and recovery retain the same visible behavior
    And missing metadata and rejected covers remain hidden without interpreting highlight text as HTML
    And remount uses the existing renderer lifecycle and source restart removes owned IPC handlers

  Scenario: Signed independent WeRead preserves source consumers
    Given default, linked, and signed independent WeRead sources receive the same isolated provider responses
    When consumers request highlights, readings, or cached health
    Then selection, synchronization, cover limits, cache data, availability, and cancellation remain unchanged
    And the signed source uses captured entry and projection modules without the default source constructor
    And corruption before discovery restores the actual default consumers
    And removal preserves verified revisions and restores the default after complete shutdown

  Scenario: Independent signed Pi sources preserve rendered consumers
    Given default and signed independent Pi sources receive the same isolated session and event responses
    When the actual preload loads their responses into the Pi page
    Then three themes and compact and wide layouts preserve the list, filters, details, and live announcements
    And loading, empty, unavailable, and recovered responses preserve the same visible behavior
    And tool identities, multiline results, and folded reasoning remain unchanged
    And DOM keyboard and Remote page events preserve navigation without claiming physical input
    And shutdown removes source handlers before the next composition starts

  Scenario: Signed installed-package runtime preserves package consumers
    Given default and independently signed installed-package runtime factories use the same verified package revisions
    When consumers list packages, fetch documents, or publish declared data
    Then both factories preserve IPC results, document policy, appearance, and data publication
    And the signed factory starts its captured runtime without the injected default start function
    And disable releases IPC, protocol, and the owned listener before enable starts another runtime
    And unchanged package publications survive the restart

  Scenario: Signed Open DeskOS Data preserves declarations and published package values
    Given default and independently signed Open DeskOS Data factories consume the same declared reading ports
    When source plugins stop, restart, or change their readings
    Then consumers receive the same identities, values, availability, and source ownership
    And unchanged package publications survive dependency restarts
    And changed package revisions invalidate previous publications
    And cancelled catalog results cannot restore removed readings
    And the signed factory constructs its registry without the injected default factory
    And the existing read-only Open DeskOS Data Link refuses mutation commands

  Scenario: Signed App Manager owns its state and preserves intent behavior
    Given the default and independently signed App Managers use the same App catalog
    When consumers list Apps, switch foreground Apps, or roll back failed transitions
    Then both implementations return the same states, errors, traces, and transition records
    And the signed factory constructs its manager without the default injected factory
    And captured manager modules survive stored-file mutation after discovery
    And disable removes IPC handlers before enable creates a fresh manager
    And rejected or removed selections start the default composition

  Scenario: Signed Futu service replacement preserves consumer behavior
    Given the default and independent signed Futu service factories use the same local publisher protocol
    When installed service declarations and publisher states change
    Then IPC and Open DeskOS Data retain the same values, percentages, provenance, and availability
    And health excludes private holdings, errors, and authentication details
    And disable closes the owned listener before enable creates another source
    And removed or corrupt selections restore the default factory


  Scenario: Authenticated runtime management controls the selected Shell renderer
    Given the Shell has one known main frame and an authenticated renderer management channel
    When the CLI discovers and changes a renderer plugin
    Then the frame controller completes lifecycle and placement coordination before returning a receipt
    And startup preferences remain unchanged
    And subframes, foreign frames, invalid receipts, and ambiguous frame ownership cannot certify a change
    And timeout or shutdown reports an uncertain mutation outcome without replay
    And running factories with failed affected placements cannot return successful receipts

  Scenario: Shell runtime lifecycle keeps placement and Remote page ownership consistent
    Given the Shell has mounted desktop and State Bar plugins
    When its runtime controller disables or enables a renderer plugin
    Then factory changes and desktop and State Bar reconciliation run in order
    And paging preserves the current page identity when that page remains
    And page names, geometry, and Remote actions match the current page elements
    And a retained cleanup failure keeps its container and reports a failed operation
    And shutdown rejects queued changes and drains active work before release
    And affected foreground Apps must close through the existing App platform

  Scenario: Runtime management resolves declared ownership before mutation
    Given independent authenticated runtime management channels publish plugin identities
    When the owner enables or disables a plugin through the runtime CLI
    Then the CLI selects its unique online runtime instead of its identity prefix
    And duplicate ownership or invalid inventories prevent mutation
    And inventory requests contain no voice, input, or private error data

  Scenario: Unified runtime management controls resident components
    Given Personal Agent has an independent authenticated management channel
    When the owner disables or enables a resident component through the runtime CLI
    Then its dependents follow the existing lifecycle graph
    And runtime changes preserve service and voice channel identity
    And service or channel changes leave management available for recovery
    And startup preferences and voice protocol records remain unchanged
    And control self-disable and foreign identities are refused
    Given saved preferences disable a resident provider or its startup fails
    When its independent management channel starts successfully
    Then management remains available to retry or enable that provider
    Given runtime initialization observes its cancellation signal
    When management disables that runtime during startup
    Then initialization drains and the runtime remains disabled

  Scenario: Resident runtime stop preserves its providers and drains voice work
    Given a Personal Agent runtime depends on a resident service and channel
    When the owner disables that runtime
    Then the Agent stops and active voice work drains
    And the service and channel remain owned by their running plugins
    And reactivation restores voice work with a new cancellation signal
    And late recording completion cannot submit a later capture
    And complete resident shutdown retains its existing resource release order

  Scenario: Unified runtime management controls only Remote Bridge transports
    Given the Bridge listener and independent transport plugins are running
    When the owner uses the runtime CLI to disable or enable one transport
    Then that transport completes lifecycle cleanup before the response
    And other transports and the Bridge listener remain available
    And listener and control identities cannot be stopped through this channel
    And existing input records and startup preferences remain unchanged

  Scenario: Explicit runtime management changes only the selected Main plugin
    Given an authenticated Main plugin control channel
    When the owner enables or disables a plugin with the runtime CLI option
    Then the host applies its dependency and cleanup rules before reporting success
    And startup preferences remain unchanged
    And unknown identities and control-channel self-disable are refused
    And failed cleanup reports failure without exposing private errors
    And lost responses report an uncertain outcome without automatic replay

  Scenario: Independent Pi source factories preserve consumer behavior
    Given default or independently linked Pi Sessions and Pi Events factories
    When consumers use their existing IPC and Open DeskOS Data endpoints
    Then reported sessions, local fallback, and Hosted Pi identity remain unchanged
    And event fallback follows the existing unavailable reasons
    And disabling one Pi source preserves the shared Open DeskOS Link and the other source
    And restart waits for retained reads and suppresses late results
    And removing the development links restores the default factories without deleting their source

  Scenario: Pi Events implements its public lifecycle without the default source factory
    Given the replacement receives Open DeskOS Link and a declared local event reader
    When reported event reads finish, fail, or require local fallback
    Then the replacement preserves complete responses and the existing fallback reasons
    And it imports no Shell modules and never invokes the default source constructor
    And cancellation drains reported and local reads before another instance starts

  Scenario: Pi Sessions implements aggregation without the default source factory
    Given a Pi Sessions factory with configured scan and Open DeskOS Link capabilities but no Shell module imports
    When consumers scan local, SSH, reported, or Hosted Pi sessions
    Then it preserves source precedence, identity deduplication, workspace summaries, and Open DeskOS Data projection
    And concurrent scans share one active request and later scans refresh
    And a reentrant provider shares that request and synchronous provider failures retain their rejection
    And cancellation drains every owned request even after a parallel request fails

  Scenario: Signed independent Pi Events preserves event consumers
    Given the Native CLI installs the event factory with publisher policy, trust, and exact grants
    When Main loads its captured signed entry and event consumers read reported or local events
    Then it preserves the shared request, fallback, parser, error, and cancellation scenarios
    And changing stored entry bytes after discovery cannot change captured execution
    And corruption before discovery restores default event consumers through reported selection rejection

  Scenario: Signed independent Pi Sessions and Events preserve shared consumers
    Given the Native CLI installs both independent factories with publisher policy, trust, and exact grants
    When Main loads both captured entries and consumers scan sessions and read events
    Then both factories preserve the shared aggregation, reading, request, error, and cancellation scenarios
    And changing stored entry bytes after discovery cannot change either captured factory
    And rejecting one corrupted selection restores only that default factory and preserves its independent peer
    And removal restores both defaults without deleting retained revision files

  Scenario: Signed Pi revisions preserve consumers after restart
    Given both independent Pi factories are installed with signed revision-specific execution markers
    When the Native CLI updates one factory or rolls it back
    Then its running instance and signed peer remain unchanged until complete Host shutdown
    And a new composition executes the selected entry and preserves session, event, and Open DeskOS Data responses
    And an unsigned entry update preserves configuration bytes and running consumers
    And removal restores defaults after shutdown without deleting either verified revision

  Scenario: A damaged independent link does not prevent replacement repair
    Given a selected development link has a missing declaration
    When the owner links an independent valid Main replacement
    Then the CLI reports the damaged plugin identity
    And it preserves that plugin preference and source files
    And it validates the remaining replacement dependency graph without executing entries
    And a replacement that requires the damaged provider fails without changing configuration

  Scenario: Pi cancellation closes only its owned Open DeskOS Link connections
    Given a shared Open DeskOS Link client has independent pending requests
    When a Pi reading plugin is cancelled
    Then its request connections close before its read completes
    And unrelated requests remain usable
    And protocol records retain their existing fields and authentication
    When the Open DeskOS Link plugin stops
    Then all its requests close before replacement
    And stopped or pre-cancelled requests create no new connection

  Scenario: Pi SSH cancellation retains the child until close
    Given a Pi Sessions source owns a running SSH collector process
    When its plugin is stopped or its parent signal is cancelled
    Then cancellation reaches the child process
    And an early abort callback does not certify child release
    And source stop completes only after the child closes
    And late collector data remains unavailable
    And normal snapshot and SSH failure responses remain unchanged

  Scenario: Pi reading plugins retain pending request ownership
    Given a Pi Sessions or Pi Events plugin has pending reads
    When the owner disables that plugin
    Then no new read or fallback scan starts
    And late responses report unavailable instead of live data
    And cleanup waits for every owned request before replacement
    And parallel requests remain owned when another request fails
    And existing callable ports and normal response contracts remain unchanged

  Scenario: A replacement consumes a linked extension without changing its public ports
    Given a trusted extension provides an internal versioned port
    And a replacement retains its built-in public port contract and requires that extension
    When the owner links the replacement and the Shell starts the complete composition
    Then linking validates the complete selected graph without executing entries
    And the extension starts before the replacement
    And existing IPC and Open DeskOS Data consumers receive the replacement values
    And missing dependencies, cycles, and conflicting ports fail before execution
    And rejected extensions cannot silently leave an invalid fallback graph

  Scenario: A damaged development link preserves independent startup selections
    Given independently linked Main, renderer, or appearance plugins
    And one selected link has an unavailable directory or invalid declaration
    When the Shell discovers startup plugins
    Then it reports that plugin identity without executing its entry
    And other valid linked plugins remain selected
    And failed discovery does not retain a reading namespace
    And strict discovery still rejects the invalid selection
    And global composition still rejects dependency and port conflicts

  Scenario: Diagnosis discovers Personal Agent through a runtime provider
    Given the Personal Agent channel plugin provides the resident client
    When diagnosis requests the personal-agent runtime port
    Then the provider returns the current resident plugin composition
    And an older or unavailable channel reports unavailable
    And stopping the provider prevents further requests

  Scenario: Smoke completion waits for the existing Shell shutdown barrier
    Given smoke mode has completed its window check
    And a Shell plugin has pending asynchronous cleanup
    When the Shell writes its result and requests exit
    Then the before-quit handlers close Native assets and cancel startup
    And the existing plugin shutdown operation completes before final exit
    And successful cleanup preserves the smoke result status code
    And repeated exit requests share one shutdown operation

  Scenario: A smoke result write failure still requests cleanup
    Given smoke mode has completed its window check
    When the smoke result cannot be written
    Then the Shell reports the write failure
    And it requests the existing shutdown barrier with failure status

  Scenario: Smoke shutdown fails within a bounded cleanup interval
    Given smoke mode has requested exit through the Shell shutdown barrier
    When plugin cleanup fails or exceeds five seconds
    Then the Shell reports the cleanup failure
    And the Electron application exits with status one
    And the Shell does not report completed plugin cleanup

  Scenario: Plugin configuration mutations preserve complete state
    Given the configuration contains plugin preferences and development links
    When a write fails or another configuration writer holds the lock
    Then the previous complete configuration remains readable
    And the CLI reports failure without replacing another writer's state

  Scenario: Removing a development link preserves its source
    Given a development plugin is linked with a saved disable preference
    When its owner removes the plugin identity
    Then the next startup does not load its module
    And its source files and disable preference remain unchanged

  Scenario: Explicitly trusted development factories join Main composition
    Given a local development plugin declares its entry and requested capabilities
    When its owner links the directory with explicit trust and grants
    Then the next Main startup discovers its versioned ports
    And linking does not execute its module
    And disabled plugins do not execute their modules
    And new capabilities require new explicit grants
    And existing built-in behavior remains unchanged without development links

  Scenario: Service plugins report health for each declared service
    Given Futu has declared services with independent live or nonlive states
    When the diagnosis channel reads its health port
    Then each service keeps its health state and timestamp
    And aggregate health cannot hide a failed service behind a healthy service
    And holdings, credentials, and source error messages remain outside diagnosis
    And health reads do not refresh service declarations or listeners

  Scenario: Plugins report source health separately from lifecycle
    Given a running source plugin provides a synchronous health snapshot port
    When the authenticated diagnosis channel reads that port
    Then it reports source health separately from the running lifecycle state
    And diagnosis does not refresh the source or disclose its reading payload
    And a failed probe cannot prevent diagnosis of other plugins
    And disabling the source withdraws its health snapshot

  Scenario: Source plugins own independent reading factories
    Given a source plugin supplies its reading factory
    When the Host creates or replaces that source
    Then its reading port uses the same source instance as its IPC handlers
    And adding that factory requires no central source-name branch
    And existing source projections retain their values, states, and timestamps
    And an invalid reading factory fails before its ports become public
    And factory failure releases its IPC handlers and owned source

  Scenario: CLI and Host validate the same plugin declarations
    Given a local plugin manifest with identity, version, host, ports, and permissions
    When the CLI validates it or the Host registers its factory
    Then both use the same declaration rules
    And validation does not execute its entry module
    And validation grants no capabilities or trust
    And dependency availability remains a Host startup check

  Scenario: Saved plugin preferences control the next Shell startup
    Given the Plugin CLI has disabled a plugin in the local configuration
    When the Shell starts
    Then Main and renderer use the same disabled plugin snapshot
    And environment disables remain effective even for a saved enabled plugin
    And invalid configuration is reported without preventing the Shell window
    And the CLI refuses to overwrite invalid configuration

  Scenario: The default composition preserves existing functions
    Given all packaged plugins use their default configuration
    When a supported Shell Host starts
    Then the existing pages, themes, readings, actions, and wire protocols remain available
    And installed package revisions and placement remain unchanged

  Scenario: Dependencies determine plugin startup
    Given plugins declare versioned provided and required ports
    When the host starts the composition
    Then providers start before their consumers
    And duplicate ports, missing required ports, and cycles fail before resources start

  Scenario: A plugin receives only its declared capabilities
    Given the host has granted specific capabilities
    When a plugin starts
    Then it receives only capabilities named in its manifest
    And it can resolve only its declared ports
    And a missing grant is reported as a plugin failure

  Scenario: Optional plugin faults remain isolated
    Given one plugin fails during creation or startup
    When the host completes startup
    Then unrelated plugins continue to run
    And required consumers report the unavailable dependency
    And optional consumers receive an unavailable port
    And allocated resources are released

  Scenario: Stop cancels startup and releases resources
    Given a plugin is awaiting an asynchronous startup operation
    When the host receives stop
    Then its cancellation signal is delivered immediately
    And completed resources are released once
    And no later plugin starts

  Scenario: A plugin can be disabled and enabled
    Given a running plugin has required and optional consumers
    When the host disables that plugin
    Then its consumers release their previous resources first
    And unrelated plugins retain their current instances
    And required consumers report unavailable
    And optional consumers restart without the port
    When the host enables that plugin
    Then its consumers use the new instance

  Scenario: Product extension points preserve existing contracts
    Given the default source, service, surface, theme, Agent, transport, and device plugins
    When one implementation is replaced through its declared contract
    Then its existing data, interaction, and protocol contracts remain unchanged
    And other components do not require business-specific changes

  Scenario: Futu Electron acceptance retains parent profile ownership
    Given the parent allocates a private Electron profile before launching the Futu fixture
    When the connected signed fixture times out and its Electron child closes
    Then the parent removes the same profile after child close
    And the child removes its signed store and publisher endpoint
    And the negative fixture connects the signed publisher without allocating a renderer window
    When Electron cannot exit before the parent deadline
    Then the parent uses an unignorable termination signal
    And profile removal waits for child close without claiming successful plugin cleanup

  Scenario: Host shutdown survives cleanup failures
    Given one plugin fails during shutdown
    When the host stops
    Then every other plugin still releases its resources
    And consumers stop before their providers
    And repeated stop requests retry failed phases without repeating successful phases

  Scenario: A failed consumer cleanup retains its providers
    Given a consumer still owns resources after shutdown fails
    When the host attempts to release its provider
    Then the provider retains its resources and withdraws its public ports
    And only the consumer cleanup can resolve its retained dependencies
    And replacement cannot create another instance over retained resources
    When a later shutdown completes consumer cleanup
    Then the provider releases its resources

  Scenario: Stop failure prevents destructive cleanup
    Given a plugin cannot finish stopping its work
    When the host requests shutdown
    Then destroy and registered cleanup wait for successful stop
    And independent plugins can complete their shutdown

  Scenario: Shell exit waits for plugin shutdown
    Given a Shell plugin has an asynchronous cleanup operation
    When Electron requests normal application exit
    Then the host postpones exit until plugin shutdown settles
    And repeated exit requests share the same shutdown operation
    And a pending startup receives cancellation before another plugin can start
    And a shutdown rejection is reported before normal exit resumes

  Scenario: Open DeskOS Data follows the active source instances
    Given Open DeskOS Data uses optional source ports and the installed package catalog
    When a source is disabled and enabled
    Then Open DeskOS Data releases its previous source reference
    And the next composition reads the new source instance
    And package synchronization completes before periodic service refresh starts

  Scenario: Service catalog refresh preserves ownership
    Given installed revisions declare service endpoints
    When the catalog changes
    Then the last declaration owns a duplicate service identifier
    And a successful refresh withdraws removed declarations
    And an unreadable catalog retains the last successful declarations

  Scenario: Appearance plugins preserve Shell and package themes
    Given the packaged appearance plugins use their default declarations
    When the Shell selects a theme
    Then Pixel remains the default Shell selection
    And an unknown selection resolves to Instrument
    And the existing storage key, semantic tokens, font faces, and scoped CSS remain unchanged
    And installed package documents use the same appearance declarations

  Scenario: A replacement appearance needs no consumer-specific branch
    Given a local appearance plugin provides a versioned theme port
    When a composition supplies that plugin
    Then the theme host resolves it by its declared identity
    And the selected factory owns startup, stop, destroy, and scoped cleanup
    And its runtime port preserves the declared appearance context
    And omitted declaration fields or tokens reject the factory before startup
    And an invalid port releases its resources before the independent fallback resolves

  Scenario: Trusted packaged appearance factories can replace implementation without changing context
    Given preloaded trusted code selects an appearance factory for an existing identity
    When the Shell validates and starts its appearance composition
    Then the selected factory executes with its own resource lifecycle
    And its declared palette, fonts, assets, geometry, and package context remain equivalent
    And invalid or duplicate factory selections leave the previous complete composition available
    And package context generation uses its declared tokens and existing font faces

  Scenario: Signed Main startup uses verified bytes and existing lifecycle contracts
    Given the operator selected a signed Main revision with explicit grants
    When Main reads its startup configuration and external publisher policy
    Then discovery verifies captured package bytes without executing entries
    And the selected factory and relative modules execute from captured verified bytes
    And stored mutations after discovery cannot change those executed modules
    And disabled or unauthorized selections execute no native entry
    And rejected revisions leave the default Main composition available
    And native and development selections cannot claim overlapping reading namespaces
    And quitting during discovery prevents factory startup
    And selected instances retain existing resource cleanup and reading contracts

  Scenario: Signed Renderer startup preserves verified assets and default recovery
    Given a signed Renderer replacement has explicit trust and exact grants
    When the Shell discovers the selected revision before Renderer startup
    Then Main captures verified entry and asset bytes without executing browser code
    And the Renderer loads captured code and CSS through the native asset protocol
    And later stored mutations cannot change those loaded bytes
    And the Renderer validates the replacement before factory execution
    And Shell readiness waits for plugin loading and composition
    And rejected entries leave the default composition and styles available
    And disabled selections and unknown asset routes load no native code
    And shutdown releases the asset protocol and captured bytes

  Scenario: Signed Appearance factories preserve the declared theme context
    Given a signed Appearance factory has explicit trust and no capability grants
    When the Shell loads its verified browser entry before Appearance startup
    Then the selected factory owns its lifecycle and publishes the unchanged theme context
    And palette declarations retain their existing separate selection behavior
    And invalid entries preserve packaged factories and saved theme preferences
    And disabled selections execute no external Appearance entry
    And page shutdown cannot start a late Appearance factory

  Scenario: Native CLI operations verify explicit publisher policy without executing entries
    Given the operator supplies a local signed bundle and an explicit public keyring
    When the operator installs or updates through the native Plugin CLI
    Then exact grants and explicit trust are required before selection changes
    And the CLI uses the Host state directory for verified revisions
    When the operator inspects or rolls back the selection
    Then the CLI verifies the selected revisions against the supplied publisher policy
    And malformed arguments or invalid signatures preserve the selected configuration
    And removal preserves stored revisions and source files
    And none of these commands execute plugin entries

  Scenario: Native revision selections retain authorization and recoverable history
    Given signed native revisions have verified identities and explicit operator grants
    When the operator installs or updates a native selection
    Then the atomic configuration records the selected revision and its authorization
    And update preserves public interfaces and the previous authorized revision
    When the operator rolls back
    Then the previous revision is verified again before selection changes
    And failed verification, conflicting ownership, or concurrent selection changes preserve the current selection
    And removal preserves source files, stored revisions, and unrelated preferences

  Scenario: Signed native revisions retain exact verified package bytes
    Given a Shell native bundle has an authorized publisher signature and a complete file inventory
    When the Host stores that bundle without executing its entry
    Then the revision contains the verified manifest, entry, and assets
    And source edits do not change the stored revision
    And every later revision read verifies the signature and file hashes again
    And unknown publishers, unauthorized identities, altered bytes, links, and unlisted files are rejected
    And a failed candidate does not change existing revisions or startup preferences

  Scenario: Authenticated runtime management controls appearance plugins
    Given the Shell provides renderer surfaces and appearance factories
    When the operator reads the authenticated Renderer inventory
    Then each appearance identity has one Renderer owner
    When the operator disables the selected Pixel appearance at runtime
    Then Instrument provides the fallback and the saved Pixel preference remains unchanged
    When the operator enables Pixel again
    Then a fresh factory restores the selected appearance
    And failed cleanup or startup cannot return a successful lifecycle receipt
    And runtime operations do not change operator startup preferences

  Scenario: A selected appearance factory preserves rendered Shell behavior
    Given the Shell starts with a trusted independent Pixel factory
    When the user selects each packaged theme
    Then computed palette, font roles, and Widget geometry match the default composition
    When the selected factory is disabled and enabled
    Then Instrument provides the fallback without changing the saved Pixel preference
    And a fresh selected factory owns the restored appearance
    When the Shell page closes
    Then the selected factory stops and releases each owned resource once

  Scenario: Renderer surfaces use the common dependency lifecycle
    Given the packaged tile, page, status, and App registrations
    When the renderer starts its plugin composition
    Then their existing mount and unmount contracts remain available
    And declared providers start before consumers
    And a failed dependency prevents only its consumer from mounting
    When the renderer stops
    Then every mounted surface releases its subscriptions once
    And a failed cleanup does not prevent other cleanup operations
    And pending surface cleanup finishes before factory shutdown
    And a pending startup cannot restart plugins after shutdown

  Scenario: Plugin diagnosis reads the active host
    Given the Shell exposes its authenticated local diagnosis channel
    When the Plugin CLI requests diagnosis
    Then the response contains current Main plugin lifecycle states
    And saved preferences remain separate from runtime states
    And an unknown plugin or absent channel cannot report healthy
    And diagnosis cannot change plugin state
    When the diagnosis plugin stops
    Then its listener and client connections are released

  Scenario: Open DeskOS Data Link retains a listener after cleanup failure
    Given the link owns a listener or is awaiting listener startup
    When shutdown cannot close that listener
    Then the link retains its listener and its required data provider
    And a replacement link cannot start over retained resources
    When a later shutdown can close the listener
    Then the listener closes before its provider is released

  Scenario: A new source contributes readings through its declared port
    Given a source plugin provides a declared Open DeskOS Data reading port
    When the Main composition includes that declaration
    Then Open DeskOS Data registers its reading without a source-specific branch
    And disabling the source withdraws that reading
    And enabling the source binds its replacement instance
    And installed package publications remain unchanged


  Scenario: Invalid reading declarations preserve the retained registry
    Given the registry contains source readings and published package values
    When a source, service, or package contribution has an invalid or conflicting declaration
    Then that contribution fails before existing readings change
    And package values remain owned by their installed revisions

  Scenario: Service plugins own their reading projections
    Given service plugins provide declared reading factories
    When their service declarations change
    Then Open DeskOS Data reconciles their readings through the generic service contract
    And a disabled service provider withdraws only its owned readings
    And Futu holdings retain their existing state and percentage projection
    And other service providers can refresh when Futu is disabled
    And repeated ticks share one active refresh
    And shutdown waits for active refresh before releasing its provider
    And conflicting or invalid service declarations leave the registry unchanged
  Scenario: Invalid health snapshots consume asynchronous component failures
    Given a health snapshot has invalid root fields or too many components
    And its component structure contains rejected promises
    When the host reads the plugin health
    Then diagnosis reports an invalid health snapshot
    And no component rejection escapes into the Shell

  Scenario: Plugins route service notifications and initial frame status
    Given the default Main plugin composition
    When a source publishes changed reading identities
    Then the notification plugin forwards those identities to the current Personal Agent
    When a Shell frame finishes loading
    Then the status plugin broadcasts the current Personal Agent status
    And only that frame receives the current Remote Link status
    When either provider is disabled
    Then new frames receive the existing unavailable or disconnected fallback
    When a provider is enabled again
    Then consumers use its replacement instance
    When either consumer plugin stops
    Then its retained callbacks cannot publish further messages
    And stopping the notification plugin does not stop the Personal Agent

  Scenario: Trusted composition replaces a built-in plugin implementation
    Given a replacement preserves its built-in identity, host, kind, and provided ports
    When the Main composition receives that replacement
    Then it registers only the replacement implementation for that identity
    And Open DeskOS Data and IPC use the replacement source instance
    And disabling and enabling it creates a new instance with the same reading identity
    When a replacement changes its external ports or has an invalid dependency graph
    Then composition fails before any plugin factory runs
    When an added development plugin conflicts with a valid replacement composition
    Then the composition retains the replacement and excludes the conflicting additions

  Scenario: Weather replacements preserve readings and resource ownership
    Given the default Weather source or an independent trusted replacement
    When IPC and Open DeskOS Data read live, stale, unavailable, or unconfigured snapshots
    Then both consumers retain the same reading identity, values, and availability
    And cached health does not initiate a provider request
    When the Weather plugin stops during a weather or location request
    Then it cancels owned requests and waits for their completion
    And late responses cannot write cache data or notify consumers
    And an enabled replacement starts with a new source instance
    And cleanup failure prevents another instance from acquiring its resources

  Scenario: Trusted renderer composition replaces a packaged surface before startup
    Given a packaged renderer surface and an explicitly selected replacement definition
    When the registry starts with compatible replacement definitions
    Then only the selected factory and mount implementation execute
    And layout identity, surface role, App routing, and provided ports remain unchanged
    And the Minimum Readable Cell declaration preserves placement behavior
    And disabled identities remain disabled
    And shutdown unmounts the replacement before releasing its factory resources
    And an asynchronous unmount retains its element until cleanup completes
    And consecutive App transitions preserve request order while cleanup is pending
    And rejected activation rolls back the App endpoint instead of reporting Running
    When a replacement changes its contract or creates an invalid dependency graph
    Then startup rejects it before any factory executes
    And the original registry composition remains available
    And the Shell reports rejection and restores the original composition with the same disabled identities
    When replacement is requested after startup
    Then the registry rejects it without changing the active composition

  Scenario: An explicitly trusted renderer development link loads through the Shell
    Given a local renderer replacement package with a browser entry and explicit trust
    When the owner links it through the plugin CLI
    Then Main keeps renderer entries separate from native Main factories
    And only known Shell main frames can request linked package entries
    And the renderer validates all replacement declarations before loading any entry
    And it loads browser scripts without weakening the existing Content Security Policy
    And each entry defines exactly its selected replacement identity
    When an entry throws after defining its replacement
    Then the original composition starts without executing the failed replacement factory
    When a link is disabled, untrusted, unreadable, or invalid
    Then its entry does not execute and the original Shell remains available
    When the owner removes the link
    Then the next Shell startup restores the default implementation without removing source files

  Scenario: A development link explicitly replaces a built-in Main plugin
    Given a trusted local replacement preserves its built-in identity and external ports
    When the owner links it with the replace option and all capability grants
    Then linking records the replacement without executing its module
    And the next Main composition selects that implementation once
    And the replacement can retain its owned built-in reading identities
    And it cannot claim another built-in source reading
    When the owner removes that link
    Then the next composition restores the original implementation
    When a saved replacement changes its external contract
    Then startup excludes it before module execution

  Scenario: Camera plugin health reads only the cached source state
    Given a Camera source has an existing cached state
    When diagnosis reads the Camera plugin health
    Then it does not refresh the source or access camera hardware
    And a live cache reports healthy with the captured time and cached-frame reason
    And an unavailable cache reports failed source health
    And missing or unknown source state remains unknown
    And the response contains no image, device path, or capture error

  Scenario: Existing Camera replacements remain compatible with optional diagnosis
    Given a saved Camera replacement provides the previous Camera source port
    When the built-in Camera adds its health port
    Then the replacement still passes composition validation
    And its undeclared health remains unknown
    And no unrelated or missing functional port becomes compatible

  Scenario: Diagnosis includes the current Shell renderer composition
    Given a Shell main frame owns renderer surfaces and appearance plugins
    When the authenticated local channel requests diagnosis
    Then Main requests a bounded snapshot from that frame
    And the response identifies the renderer runtime and its plugin lifecycle states
    And only the requested main frame can respond
    And private renderer error text is excluded
    When the frame does not respond or its report is invalid
    Then the runtime reports unavailable instead of claiming healthy plugins
    When diagnosis stops
    Then pending requests finish and its IPC subscription is removed
    When a Shell window is destroyed
    Then its diagnosis frame is removed without reading the destroyed window

  Scenario: A linked renderer replacement owns its package stylesheet
    Given a trusted renderer replacement declares a relative CSS file inside its package
    When the Shell loads that replacement
    Then Main validates the stylesheet path and size before returning its file URL
    And the renderer checks stylesheet availability before executing the entry
    And the selected replacement resolves its stylesheet from the package directory
    When the stylesheet is missing, outside the package, oversized, or unavailable
    Then no replacement entry or factory executes and the original Shell remains available
    When an entry fails after stylesheet validation
    Then no staged stylesheet changes the default composition

  Scenario: A linked Camera replacement preserves cached frame behavior
    Given the default Camera and an independently linked replacement use controlled frame providers
    When clients request frames through the existing IPC channel
    Then both return the same live or unavailable frame fields
    And both retain the minimum capture interval and reject invalid frame bytes
    And health reads the cached state without capturing frames
    When the plugin is disabled and enabled again
    Then its handler is removed and a new source starts with unavailable state
    When the replacement link is removed
    Then the default Camera factory is selected on the next startup

  Scenario: A service diagnosis request uses a negotiated publishing connection
    Given an authenticated declared service negotiated runtime diagnosis
    When the Shell requests its runtime report
    Then only the matching bounded response completes that request
    And normal service snapshots retain their existing behavior
    When the peer disconnects or does not answer before the deadline
    Then diagnosis fails without retaining pending requests
    Given an older service did not negotiate diagnosis
    When the Shell requests diagnosis
    Then no diagnosis command is sent to that service

  Scenario: A selected available runtime plugin is independent of unavailable runtimes
    Given the requested Python plugin reports its current running state
    And unrelated runtime channels are unavailable
    When the operator diagnoses that plugin identity
    Then the CLI preserves the full diagnostic response
    And its exit status depends on the selected plugin

  Scenario: A linked WeRead replacement preserves highlight consumers
    Given default WeRead and an independently linked source use controlled API responses and cache files
    When clients request highlights through IPC and Open DeskOS Data
    Then both preserve highlight selection, book cooldown, cover limits, cache reuse, and resync timing
    And both preserve empty, error, and unconfigured states
    When the plugin is disabled and enabled again
    Then its handler and reading are removed and restored with a new source
    When the replacement link is removed
    Then the default source is selected on the next startup

  Scenario: WeRead replacement waits for requests owned by the previous source
    Given WeRead has pending notebook or cover requests
    When its plugin is disabled and enabled again
    Then it aborts requests and waits for their settlement before creating another source
    And late responses do not publish state or write cache files
    Given one bookmark request fails while another remains pending
    When the plugin stops
    Then it retains the pending request until that request settles

  Scenario: Concurrent WeRead consumers retain completion order
    Given IPC and Open DeskOS Data request different cached highlights concurrently
    When their cover responses complete in reverse request order
    Then each consumer receives its selected highlight
    And the last completion remains the cached source state
    And concurrent requests are not combined into one selection

  Scenario: System channel clients retain failed stop responsibility
    Given a Personal Agent or Remote Link client fails during stop
    When the operator disables and enables that plugin
    Then the host retries the actual client stop before creating another instance
    And independent channel plugins remain running
    When client stop succeeds
    Then registered cleanup does not stop the released client again

  Scenario: Hydra retains its MQTT client until shutdown completes
    Given Hydra owns a connected MQTT client
    When its plugin stops
    Then shutdown waits for the MQTT completion callback
    And late MQTT events cannot change readings or publish updates
    And stopped snapshots cannot reopen the client
    When MQTT shutdown fails
    Then the source retains the client and blocks replacement
    And another shutdown request cannot certify release through the SDK shortcut

  Scenario: Hydra replacements preserve real SDK traffic through a controlled local endpoint
    Given default, linked, and signed Hydra sources use the canonical installed MQTT SDK
    And a task-owned endpoint listens only on loopback at an ephemeral port
    When sources subscribe and receive retained and live MQTT packets
    Then IPC, Open DeskOS Data, and cached health preserve values and availability
    And every source subscribes to its configured root
    When the Host stops
    Then the SDK connection and owned endpoint close before temporary state is removed
    When cancellation interrupts a callback that cannot finish
    Then fixture cleanup still closes its owned endpoint and reports cancellation
    And failed endpoint closure preserves temporary state

  Scenario: Independent Hydra sources receive the canonical MQTT connector capability
    Given Main grants the Hydra source capability with a canonical MQTT connection primitive
    When an independent linked or signed source starts without a test-only connection option
    Then it uses that primitive without constructing the default source
    And MQTT resolution, connection options, parsing, consumers, and connection ownership retain their contracts

  Scenario: Signed Hydra revisions preserve consumers and saved preferences
    Given signed independent Hydra sources provide controlled live, stale, unavailable, or unconfigured readings
    When the Native CLI updates, rolls back, rejects an unsigned update, or removes the selection
    Then the running source remains unchanged until complete Host shutdown
    And the next Host executes the selected version or restored default
    And IPC, Open DeskOS Data, cached health, enable preferences, and unrelated preferences preserve their values
    And shutdown closes each controlled client before another source starts
    And both retained signed revisions remain verified and unchanged

  Scenario: Linked and signed Hydra replacements preserve read-only MQTT consumers
    Given default Hydra and independent linked and signed sources use controlled MQTT clients
    When clients receive retained and live readings through the same topic contract
    Then IPC and Open DeskOS Data preserve values, timestamps, stale states, diagnostics, and availability
    And connection retries retain the existing interval and subscription settings
    And signed source execution uses captured verified bytes without the default parser or factory
    And atomic summaries, invalid messages, soil limits, and watering status preserve the protocol contract
    When the plugin stops
    Then both implementations wait for release and retain failed ownership
    When the replacement link is removed
    Then the next startup restores the default factory

  Scenario: Hydra health does not start a connection retry
    Given Hydra connection creation failed and its retry interval has expired
    When the operator reads plugin health
    Then health reports cached availability without creating a connection
    When a normal consumer requests a snapshot
    Then connection creation follows the existing retry policy

  Scenario: Appearance plugins honor operator startup preferences
    Given the operator disabled a saved appearance plugin through Shell configuration
    When the renderer selects its appearance before body content
    Then the disabled appearance falls back to Instrument
    And its runtime catalog reports the disabled plugin
    And the saved explicit appearance remains available after re-enabling that plugin
    And unrelated disabled feature identities do not change theme selection

  Scenario: A linked appearance declaration replaces its packaged identity
    Given a trusted linked appearance declares its existing theme port and local tokens
    When the Shell starts
    Then Main and the renderer select the same validated declaration
    And theme selection, saved preferences, fonts, and installed package context retain their contracts
    And no external script or stylesheet executes
    When the declaration is invalid or its link is removed
    Then the default appearance remains available

  Scenario: Quota plugins retain their pending request ownership
    Given a Quota plugin has pending provider reads
    When the operator disables that plugin
    Then its signal cancels provider requests and cleanup waits for their settlement
    And no new read or replacement instance starts before cleanup completes
    And late responses cannot return live quota data

  Scenario: An external Quota replacement preserves consumers
    Given the default Quota plugin and an independently linked replacement use controlled provider responses
    When clients read quota through IPC and Open DeskOS Data
    Then both retain account identities, quota windows, percentages, reset times, and availability states
    When the replacement link is removed
    Then the next startup restores the default Quota plugin

  Scenario: An independent Quota implementation uses only declared capabilities
    Given a Quota replacement cannot import Shell implementation modules
    When its declared provider returns quota values or fails during concurrent reads
    Then it preserves public source and reading ports without private dependencies
    And omitted measurements remain omitted instead of becoming inferred values
    And shutdown drains every retained read and suppresses late successes and failures
    And same-turn cancellation prevents queued provider requests
    And a signed selection preserves behavior after stored entry bytes change following discovery

  Scenario: Signed Quota revisions preserve consumers through release operations
    Given a signed independent Quota factory runs with declared provider responses
    When the operator updates, rolls back, or removes its stored selection
    Then the running instance changes only after the composition restarts
    And every selected revision preserves IPC responses and Open DeskOS Data readings
    And an unsigned update preserves the previous selection and running instance
    And removal restores the default factory without deleting retained revision bytes

  Scenario: Signed independent Quota preserves its Electron page consumer
    Given default and signed independent Quota factories serve actual preload IPC
    When the Shell renders the Quota page in three themes and two window sizes
    Then both show the same account values, unknown windows, errors, and accessible meter values
    And refresh reports loading, empty, unauthorized, unavailable, retained, and recovered states truthfully
    And DOM click and keyboard events move to Today and return to Usage

  Scenario: Shared enable preferences reach each JavaScript runtime
    Given the Plugin CLI saves enable preferences in the common plugin configuration
    When Personal Agent, Hosted Pi, or Remote Bridge starts or inspects its declarations
    Then each runtime applies the same saved disable preferences and environment exclusions
    And a disabled plugin does not execute its factory or start dependent components
    And unrelated plugins retain their existing behavior
    When the operator enables that plugin through the same CLI
    Then the next startup restores it unless an environment exclusion remains
    And the command does not change the running runtime

  Scenario: Renderer release failures retain surface ownership
    Given a mounted renderer surface owns cleanup callbacks and factory resources
    When unmount or a cleanup callback fails
    Then successful callbacks are not repeated and failed work remains owned
    And factory shutdown cannot complete before surface release succeeds
    And the surface element cannot mount another instance during release
    When the operator retries shutdown
    Then only unfinished release work runs again
    And independent surfaces can still release their resources

  Scenario: App shutdown retains a failed renderer release
    Given the foreground App has a surface that cannot release its resources
    When the user closes the App or opens another App
    Then the original App and its element remain owned for retry
    And endpoint rollback retains the original foreground
    And the replacement App does not mount
    When resource release succeeds on retry
    Then the App closes through the existing endpoint and Back contract

    And the close error Retry uses the same owned shutdown path

  Scenario: Failed App mounting retains incomplete resource ownership
    Given the target App fails during mounting and its cleanup also fails
    When the platform handles the failed transition
    Then it retains the target runtime and reports a failed foreground
    And it cannot restore another App onto the retained element
    When the user closes the App after cleanup can succeed
    Then the original cleanup runs again and the endpoint becomes idle

  Scenario: Renderer runtime lifecycle follows declared dependencies
    Given the renderer registry has started its selected plugin factories
    When a controller disables a renderer plugin through the registry
    Then its mounted surfaces release before its factory and required providers
    And required consumers stop while independent factories remain running
    And disabled surfaces cannot mount
    When the controller enables that plugin
    Then the selected factories restart and fresh contexts permit mounting at their retained placements
    And failed release ownership prevents new instances until retry succeeds

  Scenario: Renderer lifecycle commands preserve foreground App ownership
    Given an active App depends on a renderer plugin
    When a controller changes that plugin before closing the App
    Then the registry refuses the change before cancellation or resource release
    When the App closes through its existing platform path
    Then the controller can change the plugin lifecycle
    And repeated startup configuration cannot bypass this boundary
    And reentrant mount callbacks cannot cancel their own App through lifecycle management

  Scenario: Renderer runtime changes restore owned desktop surfaces
    Given a renderer surface has a mounted desktop or status placement
    When its factory stops through runtime management
    Then its resources release before the placement content is cleared
    And the container and its placement attributes remain intact
    When its factory becomes available again
    Then the registry mounts the selected definition with the original UI context and a fresh factory signal
    And manual deactivation or Shell shutdown removes the restoration request
    And failed release cannot clear or reuse an owned element

  Scenario: Desktop reconciliation creates previously excluded plugin placements
    Given a declared desktop contains disabled Widgets and Pages
    When the controller enables their factories and reconciles the layout
    Then missing containers mount in the declared order with their original geometry
    And existing containers and installed user packages remain intact
    When a placement is excluded again
    Then cleanup completes before its container is removed
    And failed cleanup preserves the owned container for retry

  Scenario: Runtime controller preserves the selected display grid
    Given Reading is selected in the four-page desktop
    When the controller changes the resident Overview, State Bar clock, and Reading Widget
    Then Reading retains its page identity and selection
    And Remote state keeps four display pages and no App actions

  Scenario: Runtime status placement preserves independent State Bar items
    Given the State Bar excludes one declared status plugin during startup
    When its factory becomes available and status placement is reconciled
    Then its container mounts in the declared slot and order
    And existing status containers and unrelated slot content remain intact
    When the status plugin is excluded again
    Then release completes before its container is removed
    And retained cleanup failures can recover in the same container
    And subscriptions release before the plugin can subscribe again
    When a failed status mount recovers through factory disable and enable
    Then reconciliation removes the obsolete error markers and preserves plugin-owned presentation

  Scenario: Authenticated Main activation uses the current signed selection
    Given a running Main plugin has a trusted signed revision selected on disk
    When the operator activates that identity through the existing authenticated control channel
    Then Main reads the current configuration and publisher policy again
    And Main captures verified bytes before releasing the previous factory
    And consumers restart through the existing Host replacement contract
    And the receipt identifies the selected revision and running version
    And activation does not change saved preferences
    When trust, grants, integrity, host, or enabled state prevents activation
    Then activation fails without releasing the running implementation
    And private errors do not appear in the control response

  Scenario: Main activation preserves recovery and shutdown ownership
    Given activation waits for signed capture or resource release
    When shutdown aborts the control capability
    Then activation cannot construct another factory
    And the request does not report success
    When a candidate fails during startup
    Then the existing Host cleanup and rollback rules apply
    And activation reports failure even if the previous factory recovers

  Scenario: Authenticated Main restoration selects the built-in implementation
    Given a running Main plugin uses an independent signed implementation
    When the operator restores its built-in default through the authenticated control channel
    Then the Host releases affected consumers before replacing the factory
    And the default and its consumers preserve their public behavior
    And the receipt identifies the built-in version without claiming a signed revision
    And saved selections and publisher policy remain unchanged
    And restoration does not require a valid external publisher policy
    When old resources cannot release or default startup fails
    Then restoration reports failure and retains the existing Host recovery rules
    And the control plugin and extension-only identities cannot select an invented default

  Scenario: Default restoration recomposes a valid changed startup contract
    Given a trusted startup replacement has different dependency or compatible port declarations from its built-in default
    When the operator restores the default
    Then the Host validates the candidate dependency graph before releasing any resource
    And consumers of old or new provided ports restart with the selected default
    And a failed default restores the previous graph after complete candidate cleanup
    And cycles, missing required ports, and duplicate providers fail before cancellation
    And malformed saved configuration cannot prevent the authenticated default restoration command

  Scenario: Authenticated Renderer activation loads a captured signed surface
    Given a running Shell document has its signed asset route bound before loading
    And a trusted signed Renderer selection is saved on the Host
    When the operator activates its identity through the existing management channel
    Then Main captures verified bytes using current publisher policy and grants
    And the browser loads only the exact selected entry through authenticated discovery
    And the controller replaces its retained placements without navigating
    And the receipt identifies the captured revision and selected running version
    And invalid signatures, stylesheets, contracts, or unknown surfaces preserve the running implementation
    And activation preserves saved configuration bytes
    And delayed definitions from earlier entries cannot identify a later captured revision
    And repeated activation revalidates policy without retaining another capture of the same revision
    When shutdown or frame navigation interrupts preparation
    Then no late command crosses the retired frame authority
    And ambiguous outcomes cannot certify success

  Scenario: Authenticated Renderer restoration selects the captured built-in surface
    Given the Shell captured its packaged surface factories before external entry execution
    And an enabled signed surface runs with an external stylesheet binding
    When the operator restores its built-in implementation through the existing management channel
    Then the controller releases the selected surface and restores retained placements without navigation
    And the running factory and lifecycle functions match the captured built-in implementation
    And the receipt identifies the built-in version and running state without a signed revision
    And saved configuration and publisher policy are not read or changed by restoration
    And restoration loads the captured built-in stylesheet before releasing the external surface
    And the external stylesheet remains active until its owned resources release
    And failed restoration restores the stylesheet of the retained implementation
    And disabled surfaces, open dependent Apps, and unavailable built-in stylesheets fail before release
    And ordinary runtime replacement still refuses stylesheet contract changes
    And failed cleanup, failed built-in startup, cancellation, and unknown outcomes cannot certify success

  Scenario: Unpublished signed Renderer captures release after failed preparation
    Given Main captures signed resources before publishing discovery
    When cancellation or validation prevents discovery publication
    Then preparation releases its capture ownership
    And an unowned capture releases its entry and byte allowance
    And another preparation or published selection keeps its resources available
    And independent asset snapshots retain their documented lifetime
    And live asset views cannot retire their publisher's resources

  Scenario: Uncertain Renderer implementation changes retain their operation slot
    Given Main dispatched a Renderer activation or built-in restoration
    When timeout or an invalid receipt leaves its outcome uncertain
    Then another implementation change cannot start until its original frame confirms completion
    And invalid, foreign, duplicate, or navigated-frame receipts cannot clear that operation
    And a send that exposes the request before throwing retains the same uncertainty
    And timed-out preparation retains its slot until loading settles without dispatch
    And published resources remain available for supported retained definitions

  Scenario: Authenticated Appearance recovery restores the captured built-in factory
    Given Appearance captures its configured built-in factories before external entry execution
    And an enabled signed Appearance factory provides the declared theme data
    When the operator restores the built-in factory through Renderer management
    Then the Host releases external resources before constructing the captured factory
    And theme declarations, saved preference, installed application context, and unrelated factories remain unchanged
    And the receipt identifies the captured built-in version and running state
    And restoration does not load external code or read external configuration
    And disabled identities, failed cleanup, failed default startup, and shutdown cannot certify success

  Scenario: Appearance disable cancels pending factory construction immediately
    Given an Appearance factory waits for cancellation during enable or recovery
    When the operator disables that Appearance
    Then its factory signal aborts before construction settles
    And the Host completes cleanup before the disabled operation returns
    And recovery cannot report a running built-in implementation

  Scenario: Authenticated Appearance activation preserves the configured theme contract
    Given an enabled Appearance identity has an installed signed factory revision
    When the operator activates it through authenticated Renderer management
    Then Main verifies current policy and captures the selected signed bytes
    And the browser executes only the exact captured entry
    And the Host releases the previous factory before constructing the candidate
    And the theme declaration, saved preference, installed package context, and unrelated factories remain unchanged
    And the receipt identifies the selected revision, version, and running state
    And invalid declarations, disabled identities, cancellation, and failed lifecycle work cannot certify success
    And delayed definitions cannot supply factories for later entries

  Scenario: Disabling Appearance cancels pending entry discovery
    Given Appearance runtime activation is waiting for authenticated discovery
    When the operator disables that identity
    Then discovery completion cannot execute its entry
    And the disabled identity cannot return a successful activation receipt

  Scenario: Appearance activation cancellation releases its candidate
    Given a signed Appearance candidate is waiting during factory construction or startup
    When its activation signal aborts
    Then the candidate observes cancellation
    And late candidate completion releases owned resources before restoring the previous factory
    And activation cannot report success
    And cancellation before queued replacement starts preserves the running factory

  Scenario: Completed Appearance activation does not retain request cancellation authority
    Given a signed Appearance factory has completed activation
    When the former activation signal aborts
    Then the running factory remains owned by its Host
    And disable, enable, rollback, and Host restart use fresh factory signals

  Scenario: Appearance cancellation during previous release preserves the selected definition
    Given replacement is waiting for the previous Appearance factory to stop
    When activation aborts and the operator disables the identity
    Then the candidate definition is not selected
    And later enable constructs the previous factory with a fresh Host signal

  Scenario: Appearance activation preserves discovery capacity
    Given authenticated Renderer discovery has reached its entry limit
    When the operator activates another Appearance identity
    Then activation refuses before publication
    And discovery remains usable
    And unpublished captures release if discovery fills during preparation

  Scenario: Production Main retains the actual App verification outcome during Appearance acceptance
    Given the private Main fixture uses the production App verifier without changing its result or timeout
    When a generated App passes or fails verification
    Then the fixture records the actual verifier outcome before checking installation
    And a rejected App remains uninstalled with the existing public failure response
    And the Shell retains its Appearance and releases its owned resources normally

  Scenario: Hidden Appearance acceptance advances rendered theme comparisons on Linux arm64
    Given the signed Appearance fixture uses a hidden Electron window on Linux arm64
    When it compares all three themes before and after activation and recovery
    Then offscreen rendering supplies animation frames within the existing deadline
    And the comparison retains font readiness, geometry, and theme assertions
    And the fixture does not show or focus its window

  Scenario: Linux arm64 Appearance acceptance has a bounded complete comparison budget
    Given hidden production Main compares Shell and installed App themes across signed revisions and recovery
    When the existing comparison runs on Linux arm64
    Then its fixture has a fixed 90-second deadline inside 100-second child and 110-second test deadlines
    And reading waits, CLI operations, and production verification retain their existing deadlines
    And other platforms retain their existing fixture, child, and test deadlines

  Scenario: Production Main preserves Shell and installed App consumers across Appearance activation
    Given production Main starts with a signed Appearance or no external Appearance
    And its actual verifier installs an interactive HTML App in private state
    When authenticated CLI activation selects independent signed Appearance revisions
    And built-in recovery runs with malformed configuration and revoked publisher trust
    Then Shell and installed App consumers retain all three themes' measured appearance
    And the Shell document, Clock node, App frame, and App memory state remain unchanged
    And activation and recovery preserve saved configuration and theme preferences
    And shutdown releases management channels, IPC handlers, and protocol routes

  Scenario: Runtime replacement preserves declared in-memory state
    Given affected instances declare compatible synchronous state handoff hooks
    When a Host replaces their factories
    Then it captures detached state before old resources release
    And it restores state before candidate startup and port publication
    And failed candidates cannot mutate the retained recovery snapshot
    And rollback restores the previous factory with the same state
    And failed release retains the snapshot for explicit recovery
    And ordinary disable and enable starts fresh state

  Scenario: Invalid asynchronous state hooks remain owned until settlement
    Given a state hook returns unfinished asynchronous work
    When the Host refuses that unsupported hook
    Then it waits for that work before releasing the instance or starting recovery
    And the refusal keeps the original recovery state intact

  Scenario: Stateful consumers retain state when a legacy provider changes
    Given a provider has no state handoff hooks
    And its consumer declares compatible synchronous state handoff hooks
    When the Host replaces the provider or recovers from failed candidate startup
    Then the consumer retains its state and receives the current provider
    And a complete Host restart creates fresh consumer state

  Scenario: Selected diagnosis preserves the existing public consumer
    Given the default or an independent Futu diagnosis plugin uses the same source port
    When the public diagnosis channel requests the Futu publisher
    Then both implementations return the same available runtime and plugin state
    And diagnosis does not change source readings
    And unavailable sources and failed probes retain their existing reasons

  Scenario: Diagnosis replacement preserves source lifetime
    Given a selected diagnosis plugin has an active source request
    When the Host disables diagnosis
    Then the request receives the cancelled plugin signal
    And retained diagnosis ports use that cancelled signal
    And the source remains available to other consumers
    When the Host enables diagnosis
    Then another request uses a fresh signal

  Scenario: Selected diagnosis reaches the existing Python publisher
    Given the actual Python publisher reports through the owned Futu source
    When the default or independent diagnosis plugin handles public and CLI requests
    Then both consumers report the running Python publisher
    And the same source retains its live reading
    And the publisher closes without a service error

  Scenario: Selected diagnosis preserves public consumers and task control
    Given the default or independent diagnosis plugin uses the actual task composition
    When public and CLI consumers request Hosted Pi diagnosis
    Then both consumers report the same running task service
    And ordinary task requests still work before and after diagnosis shutdown
    And unavailable legacy diagnosis does not disclose private errors

  Scenario: Selected diagnosis preserves probe ownership
    Given endpoint discovery changes from unavailable to an active task socket
    When the selected diagnosis plugin starts a request and the Host stops
    Then the pending request and retained port report stopped
    And the task socket remains available

  Scenario: Selected resident diagnosis preserves client authority
    Given the default or independent resident diagnosis plugin uses the authenticated Personal Agent client
    When public and CLI consumers request runtime diagnosis
    Then both consumers retain current runtime states and exclude private errors
    And diagnosis does not toggle the resident service
    And disabling diagnosis cancels its request without stopping ordinary client control
    And legacy clients retain their explicit diagnosis limits

  Scenario: Selected Remote Bridge diagnosis preserves input authority
    Given the default or independent bridge diagnosis plugin uses the existing Remote Link client
    When public and CLI consumers request single-adapter or multiple-transport diagnosis
    Then both consumers retain current transport states and exclude private errors
    And diagnosis sends no transport input or Shell state
    And stopping diagnosis leaves the input client owned by its provider

  Scenario: Production Main selects external diagnosis implementations
    Given all Main plugins run with private unavailable external inputs
    When startup selects Main diagnosis, external diagnosis, Renderer diagnosis, discovery, management, and control plugins
    Then public and CLI diagnosis match the default runtime reports
    And Main health reports match their declared providers before comparison across processes
    And the actual preload discovery consumer preserves its entries across disable and enable
    And runtime CLI enable and disable preserve existing frame status behavior
    And Renderer CLI enable and disable preserve Appearance state and desktop nodes
    And Main ports, desktop nodes, source navigation, and saved configuration remain unchanged
    And a missing selected implementation fails the packaged fallback guard
    And shutdown releases the actual Main handlers and diagnosis listener

  Scenario: Production Main selects service coordinators through trusted links
    Given all Main plugins run with private unavailable external inputs
    When startup selects independent service refresh, service notifications, and frame status implementations
    Then their entry markers and versions identify all selected implementations
    And public diagnosis preserves Main health and runtime reports
    And service notification publication preserves the unavailable Agent result
    And runtime CLI operations preserve frame status behavior and desktop navigation
    And a missing selected coordinator fails its packaged fallback guard
    And shutdown releases Main resources and private endpoints

  Scenario: Trusted code replaces Renderer bridge implementations
    Given Renderer control and diagnosis bridges run in their existing Host
    When trusted code replaces either bridge through the public Renderer composition
    Then the selected factory owns its request subscription
    And diagnosis reports the current bridge identities and lifecycle states
    And replacing one bridge preserves the other bridge subscription
    And rejected contracts preserve the running bridge
    And page shutdown releases the selected subscriptions and refuses replacement

  Scenario: Selected Renderer diagnosis bridge preserves Electron consumers
    Given an isolated Electron document uses its actual preload and bridge Host
    When trusted code selects an independent diagnosis bridge through the public replacement interface
    Then Main receives the same runtime report with the selected bridge version
    And the Shell document and mounted Clock remain unchanged
    And a missing selected bridge fails the version guard
    And page shutdown releases the selected diagnosis subscription

  Scenario: Selected Renderer control bridge preserves management operations
    Given default and independent control bridges use the same public Renderer controllers
    When the Host selects either bridge and receives lifecycle, activation, and restoration requests
    Then surface and Appearance receipts match their actual selected states
    And invalid activation and failed restoration cannot report success
    And shutdown fences pending lifecycle completion and releases the subscription

  Scenario: Selected Renderer control bridge preserves production CLI consumers
    Given production Main and an isolated Electron document use their actual control channel
    When trusted composition selects the independent Renderer control bridge
    Then CLI Appearance lifecycle preserves the saved theme choice
    And CLI signed Clock activation, update, and built-in recovery preserve the document and foreground App
    And a missing selected bridge fails its version guard
    And page shutdown releases the selected request subscription

  Scenario: Repeated native staging verifies an existing revision
    Given a signed revision already exists in the native store
    When publication encounters a directory collision reported as a permission error
    Then staging succeeds only after verification of the existing revision
    And a missing or corrupt destination cannot produce success
