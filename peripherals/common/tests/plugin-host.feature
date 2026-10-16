Feature: Native peripheral plugin lifecycle
  Scenario: Native runtime reports preserve generated declarations
    Given generated S3 or P4 descriptors with public manifest metadata
    When the owner serializes its current composition
    Then the actual Shell report validator accepts its declarations and lifecycle states
    And manifest versions, ports, optional dependencies, and permissions retain their source values
    And private manifest fields remain absent
    And insufficient capacity leaves output unchanged and reports the required size
    And serialization does not start or stop drivers

  Scenario: The owner reads native plugin lifecycle snapshots
    Given a native host with actual registered drivers and private configuration
    When its owner requests a snapshot between lifecycle operations
    Then the snapshot contains public identity, version, kind, lifecycle state, and enabled selection
    And it reports resource ownership and completed cleanup phases
    And it does not execute driver operations or expose configuration, resource, or lifecycle pointers
    And insufficient output capacity reports the required count without partial rows
    And a lifecycle transition rejects the snapshot without partial rows
    And snapshot field changes do not change host state

  Scenario: Dependencies start before their consumers
    Given local driver plugins with versioned ports
    When the host starts
    Then it initializes providers before consumers
    And consumers can read only declared ports

  Scenario: Invalid graphs have no hardware effects
    Given duplicate ports, a missing provider, or a dependency cycle
    When the host starts
    Then validation fails before any driver initializes

  Scenario: A driver fails after partial initialization
    Given a driver that allocates a resource before initialization fails
    When the host handles its failure
    Then it destroys that partial resource
    And independent drivers can start

  Scenario: Drivers release resources in reverse dependency order
    Given running providers and consumers
    When the host stops
    Then it stops consumers before providers
    And cleanup failure does not skip other drivers
    And repeated stop does not repeat cleanup

  Scenario: A disabled provider removes dependent ports
    Given a running provider and its consumer
    When the provider is disabled
    Then the consumer releases its resources
    And enabling the provider initializes both plugins again

  Scenario: Failed cleanup preserves owned resources
    Given a driver whose destroy operation fails with a live resource
    When its plugin is disabled and enabled again
    Then initialization waits for successful cleanup
    And the host retries cleanup without duplicating the resource

  Scenario: A consumer does not stop
    Given a consumer whose stop operation fails
    When the host stops
    Then it retains that consumer and its providers
    And independent plugins still release their resources

  Scenario: Consumer cleanup retries with a retained provider
    Given a consumer whose first stop fails
    When its next cleanup reads a declared provider port
    Then cleanup can use the retained provider resource
    And the public host port remains unavailable during teardown
