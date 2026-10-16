Feature: Installed packages belong on the desktop
  Scenario: Production Main selects installed desktop composition
    Given private installed Widget and App snapshots and a default or trusted alternative desktop factory
    When production Main starts all Shell plugins
    Then authenticated discovery executes the selected desktop factory through actual preload
    And real catalog documents mount in their saved Widget Cell and installed App page
    When a public package command moves or removes the Widget
    Then the unchanged App frame retains its counter state
    And the built-in foreground and neighboring surfaces remain mounted
    And shutdown releases installed surfaces and Main handlers

  Scenario: External desktop factories use trusted Renderer discovery
    Given an explicitly trusted development link or authorized signed desktop revision
    When the Shell discovers its browser entry during startup
    Then the selected script defines exactly its declared desktop factory
    And the common Host mounts installed surfaces through that factory
    And surface plugins and installed package authority remain unchanged

  Scenario: Desktop entry declarations reject invalid candidates before execution
    Given an external desktop declaration changes ports or adds permissions
    When trusted discovery validates that declaration
    Then its browser entry does not execute
    And the default desktop remains available

  Scenario: Shutdown cancels a pending desktop discovery reply
    Given desktop startup is waiting for read-only discovery
    When Renderer shutdown cancels startup before discovery replies
    Then discovery cancellation settles without waiting for that reply
    And a late reply cannot execute its entry
    And a late rejection is handled

  Scenario: Page shutdown cancels initial desktop startup
    Given the selected desktop factory is still starting
    When the Shell page shuts down
    Then startup cannot mount installed surfaces
    And the Host releases acquired resources

  Scenario: Shutdown drains pending desktop recovery
    Given startup failed and manual recovery waits for retained resource cleanup
    When Renderer shutdown begins before cleanup completes
    Then recovery cannot create or mount another implementation
    And shutdown waits for recovery to settle

  Scenario: Rejected mounted controllers retain cleanup ownership
    Given a mounted controller provides dispose but lacks refresh
    When the Host rejects its public interface
    Then shutdown still releases that controller
    And failed cleanup remains available for explicit retry

  Scenario: Invalid factory results allow recovery after cleanup
    Given a selected factory returns no instance after registering cleanup
    When startup rejects that result
    Then the Host runs its registered cleanup
    And a missing instance does not retain false cleanup ownership

  Scenario: Rejected asynchronous mounts retain settlement ownership
    Given a factory violates the synchronous mount contract with a pending result
    When shutdown follows interface rejection
    Then shutdown waits for that result and releases its eventual controller
    And a rejected result cannot cause an unhandled promise rejection

  Scenario: Installed desktop composition uses a replaceable Renderer plugin
    Given the Shell receives a trusted startup replacement for installed desktop composition
    When the Renderer starts the selected factory through the common Host
    Then the selected public port mounts installed Widgets and App pages
    And the Shell retains pager and Back authority
    And shutdown waits for mounted controllers and retains failed cleanup for retry

  Scenario: Widgets appear in their saved desktop cells
    Given Home and Reading already contain mounted built-in widgets
    When the installed catalog contains a widget placed on Reading
    Then its sandboxed display-only frame appears in the Reading grid
    And there is no User Applications collection page
    And built-in widgets are not remounted

  Scenario: Reconcile installed revisions and placements live
    Given an installed widget is visible
    When its revision or placement changes or it is removed
    Then its old frame is disposed
    And only changed installed surfaces are replaced
    And unrelated App state and built-in widget state remain intact

  Scenario: Ignore stale catalog responses
    Given two catalog reads are pending
    When the newer read completes before the older read
    Then only the newer catalog is presented

  Scenario: Catalog failure is not an empty installation
    Given installed content has been presented
    When the next catalog read fails
    Then a visible unavailable status identifies the stale catalog
    And existing frames remain intact until an authoritative result arrives

  Scenario: Built-in pages publish remote actions during composition
    Given a built-in App publishes its controls while mounting
    When the desktop is composed
    Then page remote state is initialized before the mount callback
    And the installed catalog can load after all built-in pages

  Scenario: Catalog recovery stays behind a foreground dialog
    Given catalog loading failed and Refresh is visible
    When a foreground dialog opens
    Then the desktop recovery controls are inert until the dialog closes

  Scenario: Interactive apps have dedicated pages
    Given an installed interactive App
    When the catalog is refreshed
    Then the App has its own named interactive page
    And its frame retains state across unrelated catalog updates

  Scenario: A release takes an installed widget's cell for a built-in tile
    Given an installed widget is placed in a Home cell
    When a release declares a built-in tile in that same cell
    Then the installed widget reports a placement error instead of sharing the cell
    And it is not mounted over the built-in tile
    And the desktop status names the widget that needs moving or removing
    And removal stays available while the cell is contested

  Scenario: An installed widget has no available desktop placement
    Given the catalog includes an unplaced widget with a placement error
    When the catalog is rendered
    Then its name and placement failure are shown in the desktop status
    And valid placed widgets still render
    And the catalog is not reported as empty or fully ready

  Scenario: Catalog removes a page while voice feedback is visible
    Given an interactive App page is selected and voice feedback is visible
    When an earlier installed App is removed
    Then navigation still identifies the selected App at its new index
    And voice feedback remains visible

  Scenario: Frame startup failure is contained
    Given an installed widget fails to become ready
    When its sandbox reports the failure
    Then its tile shows an unavailable message
    And other desktop content stays mounted

  Scenario: Installed widgets adapt without creating implicit grid columns
    Given an installed Widget has a persisted fifth-column placement
    When the desktop shrinks to a one-column viewport
    Then the Widget receives one available cell instead of creating a narrow implicit column
    And expanding the desktop restores its persisted placement without reloading its frame

  Scenario: Hidden desktop composition retains declared rendering inputs
    Given a hidden host window has different native bounds or display scaling
    When the fixture prepares its desktop document
    Then its renderer viewport is 1920 by 1280 at unit scale before pointer interaction
    And offscreen rendering supplies frames without showing the window
    And Linux uses isolated software rendering
    And catalog, frame state, recovery, shutdown, and deadline assertions remain required
