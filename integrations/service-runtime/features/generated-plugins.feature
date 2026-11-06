@planned
Feature: Create complete plugins without changing Shell authority
  # Target contract for ADR-0041. These scenarios have no executable step bindings yet.
  # Existing HTML, service-runtime, and intent scenarios continue to describe implemented behavior.

  @stage1
  Scenario: Voice and text select the same plugin creation workflow
    Given an owner requests a plugin with a Widget, an App, and private refreshed data
    When voice or text submits the request to the Personal Agent
    Then the same creation workflow delegates drafting to the configured Hosted Pi
    And the candidate identifies separate UI, Service, and data contract revisions
    And no Shell source change or runtime activation occurs

  @stage1
  Scenario: Installation intent does not authorize private Service activation
    Given the owner asks to create and place a plugin
    And its Service requires a new secret or destination grant
    When candidate verification completes
    Then the candidate reports needs-operator-trust with the exact requested capabilities
    And no provider connection or production Service starts
    And neither speech nor generated UI collects a credential

  @stage1
  Scenario: Existing private authority does not transfer to changed code
    Given an approved Service revision has active private grants
    When generated code changes the Service revision or requested capabilities
    Then the new candidate requires exact operator approval
    And a grant for the previous revision cannot authorize activation

  @stage2
  Scenario: Every package execution phase remains isolated
    Given a candidate contains dependency hooks, a worker, and an executable health probe
    When preparation or verification executes those inputs
    Then every executed input runs inside an admitted sandbox without production credentials
    And no package command executes with the manager's host authority
    And unsupported isolation refuses preparation instead of using native Python

  @stage2
  Scenario: A sandbox can write only its own bounded state
    Given two independent Service instances and a private lifecycle manager
    When one instance accesses host files, peer state, or manager metadata
    Then those accesses are refused
    And the instance can write only its granted data and IPC paths
    And aggregate CPU, memory, process, and storage limits preserve direct input

  @stage2
  Scenario: Generated code cannot bypass destination controls
    Given a generated worker has only a named read capability
    When it attempts direct IPv4, IPv6, DNS, host socket, or raw proxy connections
    Then the operating system refuses those connections
    And an approved connector accepts only its declared operations and bounded arguments

  @stage2
  Scenario: Backend failure does not enter the Shell startup dependency chain
    Given Docker is missing or a worker exhausts its limits or stalls during readiness
    When the Shell starts and its input interface receives a direct navigation request
    Then startup and direct navigation complete without awaiting the Service
    And only the affected data source becomes unavailable
    And a host check does not claim physical input acceptance

  @stage2
  Scenario: Runtime bytes must match trusted build evidence
    Given a candidate declares exact source and execution artifact digests
    When an artifact differs or its builder identity is not trusted
    Then preparation refuses the candidate
    And a successful package-owned health probe cannot override that refusal

  @stage3
  Scenario: Reuse the existing OpenD without changing its lifecycle
    Given the operator binds a Futu dependency to the existing NAS Docker OpenD
    When a plugin installs, updates, rolls back, or is removed
    Then the lifecycle manager changes only the plugin's owned resources
    And it never installs, restarts, upgrades, or removes that OpenD
    And real addresses and credentials remain outside package and release bytes

  @stage3
  Scenario: OpenD deployment is independent of plugin execution
    Given a plugin declares a versioned provider protocol without a deployment command
    When an operator selects an explicitly supported provider deployment in private configuration
    Then plugin UI and data declarations remain unchanged
    And the current Futu adapter accepts only the approved existing Docker deployment
    And a native OpenD deployment remains unavailable until its own acceptance passes

  @stage3
  Scenario: OpenD architecture cannot silently select emulation or another host
    Given a dependency supplies only an x86-64 executable
    When an operator evaluates it for an ARM64 host
    Then compatibility remains unsupported
    And the Agent neither enables emulation nor selects another host automatically
    And login state is not cloned to another host

  @stage3
  Scenario: A read capability cannot become an OpenD transaction
    Given another OpenD connection has already unlocked trading
    When generated code requests an order or a raw OpenD connection
    Then the approved connector refuses the request before upstream dispatch
    And only the reviewed connector can access OpenD credentials and its raw endpoint

  @stage3
  Scenario: Private bindings do not leak through public inspection
    Given a Service has named secret and destination grants
    When verification, status, diagnosis, or removal reports a result
    Then package bytes, releases, process arguments, and public results contain no private values
    And credentials do not enter container environment metadata
    And revocation closes affected connections and invalidates their admission

  @stage3
  Scenario: A private destination cannot weaken the public API broker
    Given the public broker refuses private and mixed DNS answers
    When an independent private binding authorizes one exact destination
    Then the public broker retains its original validation and DNS pinning
    And private connections use only checked addresses within that binding
    And redirects, unchecked retries, and proxy overrides cannot expand the destination

  @stage4
  Scenario: Closed presentation does not stop shared Service data
    Given an admitted Service refreshes one source without an open Widget or App
    When a granted UI, odk_data, or Overview requests its reading
    Then each consumer uses that source through the single registry
    And no consumer maintains a second authoritative snapshot
    And collection bounds, source measurement time, and nonlive states remain enforced

  @stage4
  Scenario: Producer data cannot replace another source or bypass collection bounds
    Given an admitted producer has one revision, generation, schema, and reading scope
    When it publishes another reading ID or malformed, oversized, or invalid-time data
    Then the adapter rejects that publication before registry admission
    And no other source or retained valid declaration is replaced
    And producer claims cannot choose host availability or receive time

  @stage4
  Scenario: Replaced producer connections cannot restore old live values
    Given a Service generation has been stopped or replaced
    When its connection returns late data or reconnects with its old capability
    Then admission rejects its data and connection
    And reconnect alone never marks retained values live
    And rollback creates a new generation even when code bytes match an earlier revision

  @stage4
  Scenario: A presentation can read only its declared data
    Given an installed UI revision has a grant for one Service reading
    When its frame requests another source or attempts to publish as the Service
    Then the request is refused
    And no package-supplied projection code runs in Main
    And private readings cannot share that generated revision with public API sources

  @stage4
  Scenario: Overview selects current approved facts without trusting source instructions
    Given a Service provides bounded data and an operator-approved home projection
    When the model returns selectors for the current registry facts
    Then the host renders only valid current selectors with source provenance
    And source text cannot grant tools, change priority authority, or become instructions
    And changed source generations invalidate pending selections

  @stage5
  Scenario: A UI-only update preserves its compatible running Service
    Given a composition references an approved Service and compatible data contract
    When only UI bytes change and the new UI grant passes verification
    Then the existing Service stays running without another OpenD login
    And the UI receives only its own verified reading scope
    And the Shell release and process remain unchanged

  @stage5
  Scenario: Interrupted activation cannot produce two admitted generations
    Given an exact composition candidate and a retained previous selection
    When activation fails or the manager stops before committing its selection
    Then recovery reconciles owned resources from the durable operation record
    And only the committed generation may publish current readings
    And uncertain cleanup blocks activation and never triggers automatic mutation replay

  @stage5
  Scenario: Rollback never restores revoked authority or incompatible data
    Given a previous code revision has revoked grants or an incompatible stored schema
    When an operator requests rollback
    Then admission refuses that revision before provider access
    And code rollback never restores secret contents or external provider state
    And persistent schema migration requires its separate approved recovery plan

  @stage5
  Scenario: Shared Service changes cannot silently break another composition
    Given two compositions reference one exact shared Service revision
    When one requests an update or rollback incompatible with the other composition's dependency or grant
    Then admission refuses the shared change or requires a separately owned instance
    And the other composition keeps its exact references without silent migration

  @stage5
  Scenario: Removing one composition preserves shared and external dependencies
    Given two installed compositions reference one approved shared Service
    When one composition is removed
    Then its frames, read grants, and disclosure grants are revoked
    And the remaining reference preserves the shared Service
    And that Service retains its producer capability
    And external OpenD, credentials, retained revisions, and recovery material are preserved

  @stage6
  Scenario: Provider failure cannot block startup or physical input
    Given Docker, OpenD, the Service, or the Personal Agent is unavailable
    When the Shell starts and the owner uses touch or the keyboard
    Then direct input remains available without waiting for that dependency
    And the affected reading reports unavailable without live holdings
    And device acceptance verifies real input separately from host fixtures

  @stage6
  Scenario: An authorized Futu rollout proves the complete read chain
    Given an operator authorizes one exact candidate and a separate CM5 acceptance window
    When the current NAS Docker OpenD supplies a newer provider reading
    Then actual Widget, App, odk_data, and Overview observations match the approved source
    And service lifecycle checks leave the original Shell and external OpenD unchanged
    And evidence contains identities and fingerprints without credentials or account payloads
