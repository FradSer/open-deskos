Feature: Personal Bot plugin composition

  Scenario: Selected Watch preserves generated advice and checkpoint identity
    Given the resident uses the default or a separate Watch factory for one owner goal
    When selected observations are unavailable
    Then no generation request or action runs
    When generation fails or returns invalid evidence references or action fields
    Then the service reports unavailable suggestions without a popup or private error details
    When valid candidates pass usefulness and grounding judgments
    Then the service publishes the same probability-ordered advice without action authority
    And judgment receives the generated-advice marker, owner goal, and resolvable evidence references
    And generation receives only selected observation fields
    When the same candidates return after presentation acknowledgement
    Then their identities remain unchanged without another automatic popup
    When Watch restarts from the default saved checkpoint
    Then selected Watch retains its identities and acknowledgement without migration
    When generation produces more accepted candidates than the push limit
    Then only the highest-ranked candidates remain pending
    When generated delivery is silent or falls within quiet hours
    Then advice remains available without an automatic popup
    And explicit listing can reveal it
    And urgent generated advice retains its quiet-hours exception

  Scenario: Independent Watch replacement preserves confirmed owner actions
    Given the resident uses the default or an independent selected Watch
    When an owner rule receives unavailable and then current synthetic evidence
    Then only current evidence produces the same owner advice and action
    And no action executes before presentation and exact confirmation
    And a confirmed action executes once through the resident Agent
    When the operator disables and enables Watch
    Then the service, channel, Agent, and Home retain their identities
    And the released Watch cannot publish or accept a service push
    And a fresh Watch resumes current suggestions
    When Watch is disabled during reading, judgment, or phrasing
    Then its provider receives cancellation and pending work settles without publication
    And late provider completion cannot change the next Watch instance
    When owner delivery is silent, quiet, routine, snoozed, suppressed, or busy
    Then default and selected Watch preserve automatic and requested presentation
    And a routine presentation records the owner day only after acknowledgement
    And no delivery check executes the proposed action
    When proposal evidence reaches its maximum age
    Then the proposal remains pending at the exact age limit
    When evidence exceeds that limit by one millisecond
    Then explicit access reports an expired proposal without a popup
    And confirmation cannot execute the expired action
    When Watch checkpoints a presented proposal and restarts
    Then its identity and presentation acknowledgement remain unchanged
    And selected Watch reads the default implementation checkpoint without migration
    And it saves an executing reservation before the confirmed action runs
    And completed or interrupted actions cannot replay after restart
    When private checkpoint writes fail or saved data is corrupt
    Then no action runs and corrupt data is not silently reset
    When the current owner rule changes or a saved action is not authorized
    Then initialization expires the old proposal before polling
    And a saved proposal without its judgment also expires
    When an offered proposal restarts without presentation acknowledgement
    Then immediate delivery retries and routine delivery waits for explicit access
    And acknowledged routine delivery stays quiet for its saved owner day
    When routine acknowledgement cannot save the owner configuration
    Then its presentation acknowledgement remains saved
    And restart retains its identity without an automatic popup
    And explicit access waits for the busy service to become available
    And exact confirmation executes the recovered proposal once

  Scenario: Independent Home replacement preserves service updates
    Given the resident uses the default or an independent selected Home implementation
    When declared reading data reaches the 8192-byte UTF-8 limit
    Then that source remains live at the limit
    When declared reading data exceeds the limit
    Then required sources retain a bounded error state and optional sources are omitted
    And omitted counts and undeclared-field filtering remain unchanged
    When required readings exceed the aggregate 48000-byte budget
    Then every required source retains its bounded data or error state
    When current plugin readings change through service pushes
    Then both publish identical facts, source metadata, and unavailable states
    And hidden sources and undeclared fields stay outside published content
    And required sources precede optional sources selected by priority within the existing limit
    When reading access fails and recovers
    Then both retain stale facts and recover current content without publishing private errors
    When the operator disables Home
    Then its released instance cannot publish and the runtime, service, and channel remain available
    When the operator enables Home
    Then a fresh instance publishes current facts
    When the operator disables Home during a pending reading
    Then the reading receives cancellation and pending refresh settles
    And its late result cannot change the next Home instance

  Scenario: Runtime disable cancels pending proactive work
    Given the default Pi adapter or selected external Agent is generating or phrasing a suggestion
    When the operator disables the runtime
    Then pending Watch work settles without publishing a proposal
    And the service and channel retain their identities
    When the operator enables the runtime
    Then a fresh Watch publishes current advice
    And callbacks from the released Agent cannot change that advice

  Scenario: Selected Agent preserves proactive consumers
    Given the resident selects the default Pi adapter or a trusted external Agent
    When the Watch processes an owner rule with synthetic current evidence
    Then phrasing preserves owner advice and no action executes before presentation and exact confirmation
    And confirmation updates the same private memory data without replay
    When the Watch processes an owner goal
    Then generated advice retains evidence and independent judgment
    And generated advice has no action or execution authority
    When the Agent cannot phrase owner advice
    Then the Watch retains the approved original advice
    When suggestion generation fails and recovers
    Then the Watch reports unavailable generation without exposing private errors and resumes grounded advice
    When an action fails after reservation
    Then its result remains unknown and provider recovery cannot replay it

  Scenario: Recovered suggestions clear the service error snapshot
    Given the service published an unavailable suggestion error
    When a later suggestion update succeeds with empty or nonempty proposals
    Then current status and subscriber updates omit the previous proposal error
    And later child activity, briefing, and conversation updates do not restore it
    And a new suggestion failure remains visible until another successful update

  Scenario: Selected Agent runtime preserves Home template updates
    Given Home uses the default Pi adapter or a trusted external Agent runtime
    When Home generates a template from a synthetic plugin reading
    Then both implementations publish the same bound facts and source metadata
    When the reading value changes
    Then Home updates the facts without another generation
    When expired template generation fails
    Then Home retains stale facts without exposing the private error
    And successful generation restores live facts
    When the runtime is disabled during generation and enabled again
    Then pending Home work settles
    And the released Home cannot publish
    And a fresh Home publishes current facts through the same resident service
    And a late generation result cannot replace the fresh facts

  Scenario: Selected Agent runtime preserves the voice service consumer
    Given the resident uses the default Pi adapter or a trusted external Agent runtime
    And recording and transcription use isolated synthetic inputs
    And the existing transcription consumer reads the selected runtime configuration
    When the service submits successful and failed requests
    Then response text, transcript, lifecycle states, and public errors remain identical
    And each transcription request uses that runtime's endpoint, model, and language options
    And each request releases its synthetic recording
    When the runtime is disabled and enabled
    Then the service and channel retain their identities
    And a fresh Agent answers the next request

  Scenario: Runtime disable cancels an in-flight voice request
    Given the default Pi adapter or a trusted external Agent is processing a synthetic voice request
    When the operator disables the runtime
    Then the request finishes and releases its recording
    And the resident service and channel retain their identities
    When the operator enables the runtime and submits another request
    Then a fresh Agent answers it
    And callbacks from the released Agent cannot change the current response

  Scenario: Hosted Pi has independent runtime management
    Given the Hosted Pi management plugin has an authenticated independent endpoint
    When the owner disables or enables a component through the unified CLI
    Then the dependency graph stops or restores its task resources
    And management remains available after listener or service disable and startup failure
    And startup preferences and task protocol records remain unchanged
    And management self-disable is refused

  Scenario: Hosted Pi service replacement preserves its listener provider
    Given the Hosted Pi listener, service, and endpoint plugins are running
    When the operator disables the service
    Then the endpoint is withdrawn and the service closes
    And the listener remains open with the existing starting response
    When the operator enables the service
    Then a fresh service attaches to the same listener and republishes the endpoint
    And complete shutdown retains the established listener-before-service close order

  Scenario: Default Agent initialization observes plugin cancellation
    Given the resident Agent factory is waiting for a startup operation
    When the runtime plugin is disabled
    Then initialization stops before the next startup operation
    And late session acquisition is drained and disposed before initialization rejects
    And pending extension binding receives session cancellation
    And failed extension binding releases the acquired session

  Scenario: Shared startup preferences disable resident work without closing diagnosis
    Given the Plugin CLI disables the Personal Bot runtime in the common configuration
    When the resident starts with that configuration
    Then the Agent, Home, and Watch factories do not execute
    And the service and resident channel remain available
    When the Plugin CLI enables the runtime
    Then the preference applies at the next startup

  Scenario: Shared startup preferences disable Hosted Pi task execution
    Given the Plugin CLI disables the Hosted Pi service in the common configuration
    When the daemon starts with that configuration
    Then the task service factory does not execute
    And the endpoint descriptor is not published
    And listener diagnosis remains available

  Scenario: Hosted Pi diagnosis preserves task control
    Given the Hosted Pi listener, service, and endpoint plugins
    When a local client requests runtime diagnosis
    Then the response identifies the personal-agent host and hosted-pi instance
    And it contains current plugin declarations and lifecycle states
    And task prompts, history, paths, errors, and Agent data are excluded
    And diagnosis does not invoke task service commands
    And existing task requests keep their protocol and results
    When the diagnosis provider stops
    Then its pending requests close without stopping the task service

  Scenario: Diagnosis reads the resident plugin composition
    Given the authenticated resident channel and the current Personal Bot plugins
    When the Shell requests runtime diagnosis
    Then the response contains current plugin identities and lifecycle states
    And private errors, voice replies, readings, and Agent data are excluded
    And diagnosis does not toggle recording or run Agent work
    And only clients requesting diagnosis capability receive its status marker
    And older clients retain their existing status frame bytes
    And older residents receive no unknown diagnosis command
    When the channel disconnects or the Shell client stops
    Then pending diagnosis requests finish with an unavailable runtime

  Scenario: The resident channel remains available during Agent initialization
    Given the default Personal Bot plugins
    When Agent initialization fails
    Then the service and channel remain available with the existing configuration error
    And the briefing and suggestion plugins do not start

  Scenario: Personal Bot plugins retain their shutdown order
    Given the voice service, channel, Agent, briefing, and suggestion plugins
    When the host stops
    Then briefing and suggestions close before the channel
    And the channel closes before Agent cancellation
    And the voice service closes before the Agent resources
    And successful cleanup operations run once
    And cleanup failure cannot skip independent resources
    And cleanup failure retains the failed process exit status

  Scenario: Personal Bot retries unsuccessful shutdown
    Given a service close operation fails during shutdown
    When the service can close and the caller requests shutdown again
    Then the composition retries the unsuccessful operation
    And it releases the retained providers
    And completed Agent and channel cleanup do not run again

  Scenario: Stop cancels pending Agent startup
    Given Agent initialization is pending
    When the host stops
    Then the late Agent releases its resources
    And briefing and suggestion plugins do not start

  Scenario: Hosted Pi retries failed channel cleanup
    Given the Hosted Pi channel close operation fails
    When the composition reports unsuccessful shutdown
    Then it retains the channel cleanup operation
    And a later close request retries that operation
    And completed service and endpoint cleanup do not run again

  Scenario: Selected Hosted Pi service retains failed connection cleanup
    Given the default or selected service owns a task connection
    When connection release fails during service disable or full shutdown
    Then the service remains owned and has not closed
    When connection release succeeds and cleanup is retried
    Then the connection releases before the service closes once
    And the selected service never constructs the default factory

  Scenario: Resident components select compatible external startup factories
    Given explicit trusted entries declare existing resident component contracts
    When the resident starts with those selected replacements
    Then each selected factory supplies its actual component port
    And runtime callbacks and resource cleanup preserve the resident contract
    And invalid contracts fail before any selected factory executes

  Scenario: Resident startup inspection does not execute external entries
    Given a startup selection references trusted native CommonJS entries
    When the operator validates its declarations
    Then no entry or operational provider executes
    And operational startup loads entries only when their components initialize

  Scenario: Hosted Pi selects trusted external component factories
    Given compatible listener, service, and endpoint declarations with explicit native trust
    When the daemon starts with external factory entries
    Then the selected components supply their actual runtime ports
    And task requests and diagnosis retain their existing protocol
    And endpoint publication and shutdown retain resource ownership
    When a controlled task runs through the selected service and the operator disables it
    Then its receipt exists before execution and cancellation settles before disable completes
    When the operator enables the service and repeats the same start request
    Then the saved cancellation remains readable without executing the task again
    When new controlled tasks complete or fail through the selected service
    Then their terminal receipts retain the result and no verification claim
    And repeating either start request does not execute or rewrite its terminal record
    And shutdown preserves both terminal records
    When the operator inspects declarations
    Then no external entry or operational provider executes

  Scenario: Independent Hosted Pi service reads existing terminal records
    Given private task records include finished, failed, cancelled, and interrupted outcomes
    And a terminal record contains a UTF-8 response at the existing byte limit
    When the default or independent service starts through trusted composition
    Then list preserves goal previews and excludes private task details
    And status retains each saved task identity and outcome without replay
    When the service is disabled and enabled
    Then the listener retains its identity and the fresh service reads the same records
    And endpoint publication follows service availability
    And the saved record bytes remain unchanged

  Scenario: Overview and suggestions have independent lifecycles
    Given the default Overview and Watch plugins are running
    When the operator disables Overview
    Then Watch keeps its identity and continues to read declared sources
    And its pending proposal checkpoint remains unchanged
    When the operator enables Overview
    Then only Overview receives a new instance
    And a legacy Watch replacement retains its declared Overview dependency

  Scenario: Resident producers expose declared read-only readings
    Given resident task and remote report providers own their current data
    When Open DeskOS Data reads their declared service readings
    Then it receives bounded public projections from the current owners
    And no Overview-specific source adapter or copied values are used
    When a producer is disabled or unavailable
    Then its reading becomes unavailable without blocking other sources
    And neither a read nor a listing starts generation or a mutation

  Scenario: Invalid producer inventories cannot disable healthy siblings
    Given independent producers expose public reading declarations
    When one inventory is malformed, unserializable, or individually oversized
    Then healthy siblings remain listed and readable
    And Shell accepts compatible declarations independently after JSON transport
    And control retains its App and optional Home declaration contracts
    When producers declare the same reading identity
    Then the conflicting identity is unavailable
    And unrelated reading identities remain available
