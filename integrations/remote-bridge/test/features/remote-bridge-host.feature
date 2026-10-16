# Feature: Remote Bridge Transport Plugins and Host Arbitration

  Scenario: Shared startup preferences exclude a transport
    Given the Plugin CLI disables a transport in the common configuration
    When Remote Bridge starts with that configuration
    Then the transport factory and resource startup do not execute
    And the listener remains available
    And environment exclusions override saved enable preferences

  Scenario: Diagnosis reads the bridge plugin composition without changing input
    Given either bridge entry point owns its listener and transport plugins
    When a separate local connection requests runtime diagnosis
    Then the response contains current plugin identities and lifecycle states
    And private errors and retained Shell state are excluded
    And diagnosis does not change transport selection or send device commands
    And existing clients retain their link and navigation records
    When an older bridge ignores the diagnosis request
    Then the request times out without closing the existing input connection

  Scenario: Remote Bridge Host dynamically loads transport plugins
    Given a Remote Bridge Host is initialized with transport plugins
    When the host starts
    Then it initializes and starts the highest-priority available transport
    And Unix domain socket clients receive the active link state

  Scenario: Remote Bridge fails over from USB CDC to wireless gateway
    Given both USB CDC and Wireless Gateway transports are registered
    When USB CDC connects
    Then the active transport is USB CDC with link state usb
    When USB CDC disconnects and Wireless Gateway is active
    Then the active transport transitions to wireless with link state wireless
    And the Unix domain socket connection is not closed

  Scenario: Remote Bridge stops even when a serial read is pending
    Given the USB CDC Remote connection has an active read stream
    When systemd stops or restarts the Remote Bridge
    Then both serial streams close before the stop deadline
    And the service can immediately start and reconnect

  Scenario: Remote Bridge relays versioned Remote Touchpad input
    Given a Display Shell client is connected to the Remote Bridge
    When a Remote Link adapter sends a direction, primary, or secondary Remote Touchpad record
    Then the bridge forwards the same versioned record to the Display Shell client
    But it discards an unsupported Remote Touchpad input record

  Scenario: Both bridge entry points use the common plugin lifecycle
    Given a single adapter bridge or a multiple transport host
    When the bridge starts
    Then the socket listener starts before the transport plugins
    And each transport appears in the common plugin catalog
    When the bridge stops
    Then transport subscriptions are removed
    And transport stop failure retains its socket provider until retry succeeds
    And a later start subscribes once to each transport

  Scenario: A transport plugin can be removed without closing the listener
    Given USB CDC and a connected wireless transport
    When the USB plugin is disabled
    Then the host selects the available wireless transport
    And the socket listener remains open

  Scenario: Retired synchronization cannot change the current link state
    Given a transport is sending the retained Shell state
    When a higher-priority transport replaces it
    Then the retired send cannot mark the replacement as synchronized

  Scenario: Listener cleanup needs another attempt
    Given the bridge owns its server and socket path
    When server close or socket cleanup fails
    Then the bridge retains the unsuccessful resource ownership
    And the next stop request retries the unfinished operation

  Scenario: USB CDC stop overlaps device opening
    Given the adapter is opening a device connection
    When stop cancels the adapter
    Then stop waits for the pending open operation
    And it retains any connection whose cleanup fails
    And retained connections cannot relay input or accept writes

  Scenario: USB CDC descriptor close fails
    Given a connection owns an operating system descriptor
    When descriptor close reports an error
    Then the connection reports unresolved cleanup
    And later cleanup returns that failure without risking another descriptor close

  Scenario: USB CDC cleanup waits for active reads and writes
    Given a connection has an active read or queued write
    When the connection closes
    Then it cancels future polling and rejects new writes
    And it releases the descriptor only after active operations finish
    And an operation timeout retains the descriptor for a later cleanup attempt
    And repeated close requests share the current attempt

  Scenario: Existing record lengths remain compatible
    Given the reader has no explicit byte limit
    When a valid protocol record exceeds 64 KiB
    Then the reader delivers the complete record

  Scenario: An explicitly bounded reader discards oversized lines
    Given a reader has an explicit 64 KiB limit
    And an incoming line exceeds that limit
    When the line arrives across one or more reads
    Then the reader discards that line until its newline
    And it does not deliver its contents to protocol handlers
    And the next bounded line retains its UTF-8 contents and normal routing

  Scenario: Multiple transports retain all current Remote input records
    Given a running Host with USB and wireless transport plugins
    When either transport emits a valid version 1 input record
    Then connected Shell clients receive the unchanged record
    And navigation, selection, Back, microphone requests, and declared actions retain their protocol
    When a transport emits an invalid input record
    Then the Host does not forward that record
    And a disabled transport cannot forward more input

  Scenario: Trusted external transports load during plugin initialization
    Given explicit native trust and compatible external transport declarations
    When the bridge initializes its selected transport plugins
    Then external factories supply the actual transport instances
    And input, state synchronization, diagnosis, fallback, and cleanup preserve their existing contracts
    When the operator inspects declarations
    Then external entries and device discovery do not execute
    When transport cleanup fails
    Then the host retains ownership before another instance can initialize

  Scenario: The operational entry selects trusted external transports
    Given an explicit startup selection with native trust
    When the operator starts the bridge
    Then the selected factories provide its actual transports
    And the existing USB transport remains the default without a selection
    When the operator requests offline inspection
    Then no transport factory or device discovery executes
    When termination completes
    Then each selected transport releases its resources once

  Scenario: External transport replacement preserves priority and fallback
    Given running USB and wireless transports from trusted external entries
    When both transports connect and the Shell sends its state
    Then USB receives the wired state and all current Remote inputs remain unchanged
    When the USB plugin is disabled
    Then wireless receives the retained state and the listener remains available
    And retired USB callbacks cannot forward input
    When the USB plugin is enabled again
    Then a fresh external instance resumes USB priority without duplicate subscriptions

  Scenario: Cancellation drains an external transport factory
    Given a selected transport factory with pending initialization
    When bridge shutdown cancels initialization
    Then shutdown waits for the factory allocation and its registered cleanup
    And the canceled transport does not start or retain subscriptions
