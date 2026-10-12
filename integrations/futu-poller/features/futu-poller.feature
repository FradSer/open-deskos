Feature: Futu poller desk links
  Scenario: Windows management uses authenticated overlapped pipe operations
    Given a Windows management listener has the shared channel token
    When clients submit bounded newline-delimited commands
    Then the owner processes connect, read, and write completion without a worker lifecycle thread
    And missing or incorrect tokens cannot dispatch commands
    And partial writes retain the remaining response bytes
    And shutdown retains pending operations until cancellation completes
    And a pipe already owned by another listener cannot be replaced
    When the unified CLI manages controlled Python resources through native Windows pipes
    Then a wrong token cannot disable the publisher
    And disable and enable replace the publisher and its dependent loop
    And the control channel and independent gateway retain their identities
    And control self-disable is refused without changing saved preferences

  Scenario: Failed management startup preserves independent polling
    Given the selected management endpoint cannot start safely
    When independent publisher, gateway, transport, and loop components can start
    Then the poller retains their original publication behavior
    And diagnosis reports the failed management component
    And shutdown preserves unrelated endpoint files
    And a simultaneous feature failure retains the original fatal error when management is unavailable

  Scenario: A managed loop failure remains explicitly recoverable
    Given an independent control plugin and a running loop own their resources
    When the loop raises an execution error
    Then the host records failure and releases the failed generation
    And management and independent providers remain available
    And failed cleanup retains resources until an explicit retry succeeds
    And the CLI can enable a new loop without changing saved preferences
    And an error from a retired loop cannot fail its replacement
    And a poller without management retains its original error exit

  Scenario: Operational Python management survives component transitions
    Given the operational poller has a local runtime directory
    When the CLI disables and enables publisher, gateway, transport, or loop components
    Then an independent protected control plugin remains available
    And the old loop stops using released resources before a new loop publishes
    And the default records and polling interval remain effective
    And failed provider startup remains recoverable through the control channel
    And normal shutdown closes the management endpoint

  Scenario: Independent Python management transport runs on the resource owner thread
    Given an authenticated management channel belongs to a Python composition
    When a client submits one bounded common command
    Then the owner dispatches the command and returns a correlated result
    And a wrong token, invalid envelope, or oversized frame cannot change resources
    And idle clients cannot block other clients
    And closing the channel removes only its owned endpoint
    And successful commands retain a response delivery interval after dispatch
    And restart recovers a stale owned socket while preserving active listeners and unrelated files

  Scenario: Python management commands preserve the common control contract
    Given a running Python composition owns its resources
    When its owner dispatches inventory, enable, or disable commands
    Then inventory exposes only component identities and host types
    And lifecycle commands return the selected component's actual state
    And unknown, protected, stopped, or malformed commands do not change resources
    And commands above the common request budget fail before lifecycle changes
    And cleanup failures remain retryable without private error details
    And runtime commands do not write saved startup preferences

  Scenario: Python plugin operations stay on their resource owner thread
    Given a Python plugin host belongs to its constructing thread
    When another thread requests lifecycle changes or reads owned state
    Then the host refuses before it changes declarations, preferences, ports, or resources
    And plugin context operations cannot bypass that boundary
    And runtime start, run, and close refuse before they clear retained errors
    And the owner can still stop, restart, diagnose, and release the plugins

  Scenario: Shared CLI preferences control Python startup
    Given the common Plugin CLI saves Futu component enable preferences
    When the poller starts or inspects declarations
    Then it applies saved disables and environment exclusions for known Futu identities
    And standalone preferences and explicit startup disables remain effective
    And disabled provider and loop factories do not execute
    And unrelated runtime preferences and development entries do not execute
    When shared configuration is missing or invalid
    Then default selection and explicit disables remain effective
    And invalid shared configuration produces a diagnostic without private content
    When the JSON decoder rejects nested data
    Then the reader reports the same generic diagnostic and retains explicit disables
    And it does not change the shared file

  Scenario: An enable request has an invalid value
    Given a running Python plugin
    When an enable request does not contain a Boolean value
    Then the host rejects the request before it changes state
    And the current instance remains active

  Scenario: A synchronous plugin lifecycle returns asynchronous work
    Given a Python plugin returns an awaitable from a lifecycle operation
    When the synchronous host receives that result
    Then it reports an unsupported asynchronous operation
    And a failed shutdown retains the plugin and its required providers
    And unstarted coroutines are closed without running their bodies
    And a synchronous retry completes only unfinished cleanup

  Scenario: A desk that closes its channel is retried as unavailable
    Given a configured desk connection closes after a record is written
    When the poller reads the desk response
    Then it treats the record as undelivered
    And it releases the closed connection for the next poll

  Scenario: The poller uses replaceable local components
    Given publisher, gateway, and loop plugins with versioned ports
    When the poller starts
    Then providers start before their consumers
    And replacement factories retain protocol v1 records

  Scenario: A replacement component omits its required operation
    Given a publisher without send, an authenticated gateway without snapshot, or a loop without run
    When the poller starts its composition
    Then it rejects the invalid component before polling begins
    And it releases resources owned by the invalid component
    And required consumers do not start
    And an unauthenticated gateway still avoids SDK initialization

  Scenario: A component factory returns asynchronous work through the poller adapter
    Given a publisher, authenticated gateway, or loop factory returns a coroutine, Future, or custom awaitable
    When the poller adapts the factory result into a provided port
    Then it rejects that result before publishing the port
    And it closes unstarted native coroutines without running them
    And it consumes failed Future results without waiting or cancelling work
    And it does not call arbitrary awaitable cleanup methods
    And it releases cleanup registered by the factory

  Scenario: Default and independent gateways share polling acceptance
    Given the default gateway with synthetic SDK inputs and an independently loaded replacement gateway
    When each gateway runs through the same publisher and polling scenarios
    Then both publish the same nonempty holdings, totals, and protocol v1 identity
    And both retain polling intervals, timestamps, and recovery after one failed poll
    And no authentication or an explicit gateway disable excludes the gateway factory
    And the replacement does not call the built-in gateway or polling calculation

  Scenario: Missing credentials preserve the authentication request
    Given no trade password
    When the loop performs one iteration
    Then it publishes the existing auth-required record
    And it does not load the Futu SDK

  Scenario: A gateway fails during initialization
    Given a publisher and a gateway with one open context
    When the next context fails to open
    Then the open context and publisher close
    And the original initialization error reaches the caller

  Scenario: One cleanup fails
    Given running publisher and gateway plugins
    When a gateway cleanup fails
    Then unrelated plugins still close
    And the gateway retains failed cleanup for another attempt
    And its providers remain owned until gateway cleanup succeeds
    And successful cleanup operations do not run again

  Scenario: Stop failure prevents destructive cleanup
    Given a plugin still has active work after stop fails
    When the host completes its shutdown attempt
    Then destroy and cleanup wait for successful stop
    And replacement cannot initialize over retained resources

  Scenario: One trade context cannot close
    Given the gateway owns Hong Kong and United States trade contexts
    When one context close operation fails
    Then it still attempts to close the other context
    And it retains only contexts whose close operation failed
    And later cleanup reports the retained SDK failure without assuming a second close releases resources

  Scenario: One publishing connection cannot close
    Given the publisher owns connections to two desks
    When one connection close reports an error
    Then it still closes the other desk connection
    And it retains the unresolved connection and reports its failure
    And it cannot reuse or replace that connection

  Scenario: Cleanup cannot restart a stopped provider
    Given one cleanup requests a provider restart
    When the host stops
    Then it rejects the nested lifecycle change
    And no provider port remains active

  Scenario: A replacement gateway fails to restart
    Given a running poller whose gateway has been disabled
    When the replacement gateway fails during enable
    Then the next start reports the original failure
    And the publisher releases its resources

  Scenario: The operator inspects Python plugin declarations without starting providers
    Given the operator supplies plugin inspection arguments
    When the poller lists or validates its plugin declarations
    Then it reports the python-agent composition without opening channels or loading the SDK
    And it excludes environment credentials and private endpoint values
    And it marks the inventory as declarations rather than live health

  Scenario: The operator disables a component at startup
    Given an explicit disabled plugin identity
    When the poller creates its composition
    Then that component does not execute its factory
    And required consumers remain blocked
    And independent components retain their existing lifecycle
    When the disabled identity is unknown
    Then composition rejects it before any factory executes

  Scenario: The operator persists Python component selection
    Given an explicit plugin configuration file and a known component identity
    When the operator disables that component through the poller CLI
    Then the configuration saves its disabled preference without starting providers
    And another component preference remains unchanged
    And inspection reports the saved selection without claiming live control
    When the next poller startup reads that configuration
    Then it excludes the disabled factory and blocks required consumers
    When the operator enables that component
    Then the next composition restores its selection

  Scenario: Configuration failure preserves existing Python preferences
    Given an existing configuration or a writer that owns its lock
    When another write is invalid, fails before replacement, or encounters the owned lock
    Then existing preferences remain unchanged
    And no writer removes another writer's lock
    And malformed startup configuration fails before any provider executes

  Scenario: The running Python composition reports its owned plugin states
    Given a poller runtime with actual registered components and private capabilities
    When its local diagnosis API reads that composition
    Then it reports the current lifecycle state and enabled preference for each component
    And it does not refresh readings, invoke factories, or open resources
    And it excludes private errors, capability values, and extra manifest fields
    And undeclared health remains unknown
    And the Shell runtime report validator accepts the report
    When its public report exceeds the supported bound
    Then diagnosis reports unavailable without exposing the oversized content
    And the byte budget counts UTF-8 encoding and all reported components
    And excessive component counts fail before serialization

  Scenario: Python declarations retain the shared manifest field types
    Given a declaration whose schema version is a Boolean or whose semantic version uses non-ASCII digits
    When the Python host registers that declaration
    Then it rejects the declaration before factory execution
    And accepted declarations retain the Shell manifest contract

  Scenario: Runtime diagnosis is negotiated on the existing publishing link
    Given a publisher owns a readable connection and a runtime report callback
    When the Shell accepts its diagnosis capability
    Then a matching diagnosis request returns the owned runtime report
    And diagnosis does not invoke the gateway or change data publication
    When the connection closes or an older Shell omits the capability
    Then no diagnosis report is sent

  Scenario: The default publisher uses a replaceable connection transport
    Given a replacement transport supplies the declared connect operation
    When the default publisher opens a target endpoint
    Then it uses that transport without invoking the default connection factory
    And it preserves service identity, revision, token handshake, and published records
    When the publisher cannot release a connection
    Then the transport remains owned until consumer cleanup completes
    Given a custom publisher does not use the built-in transport
    When that transport is disabled
    Then the custom publisher retains its existing behavior

  Scenario: A single target retains its configured authentication token
    Given the publishing endpoint uses TCP or a Windows named pipe
    And the environment declares its channel token file
    When target selection uses the single endpoint fallback
    Then the selected target retains that token file

  Scenario: Invalid readable transports preserve independent desk connections
    Given a replacement connection cannot support selectable diagnosis reads
    When the publisher checks its readable operations
    Then it closes the invalid connection before advertising diagnosis support
    Given one negotiated connection has an invalid descriptor and another receives a request
    When the publisher waits between publications
    Then it retires the failed connection and answers the independent request

  Scenario: Trusted local Python replacements load through an explicit startup selection
    Given a local package declares a compatible Python component and entry
    When the operator selects its directory with explicit trust and capability grants
    Then the running composition uses its factory and declared version
    And inspection validates declarations without executing entry code
    And disabled or unauthenticated gateway factories do not execute entry code
    When trust, grants, identity, ports, or entry containment are invalid
    Then composition fails before any replacement entry executes

  Scenario: Concurrent directory changes cannot select an outside Python entry
    Given a trusted package selects an entry below its package directory
    When an entry ancestor becomes a symbolic link before the file opens
    Then the loader rejects that path or reads the originally selected directory
    And it never captures entry bytes from outside the selected package

  Scenario: Windows development selections preserve extended path names
    Given a selected Python entry uses an extended drive or UNC path
    When its opened handle resolves to the same canonical file
    Then the loader accepts the selected entry
    And a different final path remains rejected before reading

  Scenario: A selected Python entry failure reports operational failure
    Given startup selects a trusted replacement loop
    When its import, factory, or run operation fails
    Then the operational command returns failure
    And registered factory resources are released
    And the default loop does not run in its place
