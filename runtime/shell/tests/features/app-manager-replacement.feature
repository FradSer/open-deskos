Feature: Independent App Manager replacement
  The public manager contract preserves navigation and lifecycle behavior.

  Scenario: Independent signed navigation owns its algorithm
    Given an App Manager bundle with its own state transitions and static catalog
    When the actual CLI installs it and the Host selects its captured modules
    Then navigation uses no default manager factory
    And later stored module changes do not change the captured implementation
    And existing IPC results and ordered traces stay compatible

  Scenario: Independent development navigation uses the public Host
    Given an independent App Manager directory in private test state
    When the actual CLI links it with explicit replacement and grants
    Then the Host selects its own navigation algorithm
    And disable removes its IPC handlers
    And enable reconstructs the existing fresh state

  Scenario: Lifecycle sequences preserve state and recovery
    Given default and independent managers with the same catalog
    When lifecycle, installation, and rollback operations run in deterministic sequences
    Then results, visible catalog, individual states, and foreground stay equal
    And malformed actions retain their existing errors

  Scenario: Product navigation rules hold independently
    Given either manager with UI Apps and a service
    When another UI App starts directly while the foreground is occupied
    Then the manager refuses it without changing the foreground
    When dispatch opens another App and mounting requires rollback
    Then valid recovery restores the previous foreground and target state
    And invalid recovery leaves all state unchanged
    And starting a service preserves the UI foreground
    And returned capability arrays cannot change the catalog

  Scenario: Actual browser navigation preserves recovery
    Given default and independently loaded managers with the actual preload and Shell
    When browser pointer input selects Back and browser keyboard input sends Escape
    Then the foreground closes and focus returns to the original control
    When an App mount fails
    Then the previous running App and target state are restored
    And a replacement that omits rollback fails the same acceptance checks
    And rejection requires its expected error and a normal failure exit
    And a timeout or killed process cannot establish rollback rejection
    And IPC handlers release before the window closes

  Scenario: Independent manager starts through real Main composition
    Given private configuration selects a signed or development manager
    When production Main loads the actual Shell document and preload
    Then the selected manager owns construction
    And catalog, Back, Escape, focus, and mount recovery match default behavior
    And normal shutdown removes all production handlers

  Scenario: Invalid signed selection restores the built-in manager
    Given the stored signed manager bytes have changed
    When production Main starts with that saved selection
    Then the built-in manager supplies the existing navigation behavior
    And the invalid external algorithm does not execute

  Scenario: Runtime replacement preserves App Manager state
    Given Clock is the running foreground and Pomodoro is removed
    When a signed implementation replaces the manager in the same Host
    Then the foreground and complete installation state stay unchanged
    And the Native activator reports success only after state restoration
    When candidate startup fails
    Then the original factory returns with its paused foreground and removed Apps

  Scenario: State restoration validates before mutation
    Given a captured manager state with all catalog identities
    When a manager restores compatible state
    Then it copies every lifecycle state and the foreground identifier
    And snapshot mutation cannot change the manager
    When restoration receives malformed or incompatible state
    Then it refuses without changing any state

  Scenario: Authenticated Main activation retains the mounted foreground
    Given production Main has an active Clock surface and removed Pomodoro
    When the CLI activates the signed manager and restores the built-in manager
    Then the same document and mounted Clock surface remain active
    And the complete manager state and saved configuration stay unchanged
    When the candidate refuses state restoration
    Then activation fails and the built-in manager recovers the same state
    And Escape still closes the retained foreground

  Scenario: App Manager replacement preserves an enabled Main composition
    Given every Main plugin is enabled with private state and controlled unavailable external providers
    And the actual Shell mounts its configured desktop surfaces
    When authenticated activation replaces the manager or recovers from candidate restoration failure
    Then manager state and the mounted foreground stay unchanged
    And all Main peers retain their running ports and mounted desktop nodes
    And normal shutdown releases the private listeners and IPC handlers
