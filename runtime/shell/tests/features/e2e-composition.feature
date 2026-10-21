Feature: E2E validates the current declarative desktop
  Scenario: Hidden comparisons have an active render target
    Given Appearance and Hydra checks retain real Main, preload, and comparison assertions
    When they run without a visible desktop window
    Then their windows render offscreen with background throttling disabled
    And production window preferences remain unchanged
    And the checks do not wait for throttled hidden-window animation frames

  Scenario: Interaction checks preserve the user's desktop
    Given E2E runs the Shell and its child fixtures
    When the fixtures verify keyboard navigation and theme behavior
    Then each child uses a temporary profile before loading its fixture
    And the parent and each child set user data and session data to their temporary profile before readiness
    And all fixture windows remain hidden without requesting desktop focus
    And keyboard checks retain native button activation and visible focus assertions
    And child failure or timeout removes the profile owned by the launcher
    And a locked Windows profile does not prevent fixture termination
    And Windows indicator checks can complete the existing page and theme matrix

  Scenario: Every declared widget is present once
    Given the current desktop layout declares its widget identities
    When E2E inspects the Home page
    Then the rendered widget identities exactly match the declaration
    And each widget retains readable content, truthful state and bounded geometry

  Scenario: Geometry validates every grid page rather than the selected viewport
    Given Home and Reading each declare widgets in the horizontal pager
    When E2E checks compact desktop geometry while Home is selected
    Then every widget is horizontally contained within its own page
    And content below its page boundary is reachable only when that page scrolls

  Scenario: Current providers and widgets expose readable state
    Given quotas are unconfigured and the current Home widgets are mounted
    When E2E reads Today and every widget signal
    Then Today reports the quota service is not configured
    And WeRead exposes its highlight state

  Scenario: Consecutive Remote navigation preserves distinct input
    Given the pager is on Home
    When two next navigation events arrive consecutively
    Then the pager advances through Reading to Pi Sessions

  Scenario: Required shell content produces actionable regression failures
    Given the Electron shell has mounted its current declarative desktop
    When E2E reads required clock, dashboard, widget and app content
    Then each required selector resolves to a mounted element
    And a missing element reports its selector instead of an anonymous null textContent error

  Scenario: Unconfigured quotas remain truthful in the current Usage App
    Given the quota service fixture is not configured
    When E2E opens the AI usage App from its Home Widget and refreshes quotas
    Then the live quota metrics region explains that actual quotas have not been retrieved
    And no account cards, quota meters or fabricated percentages are rendered
    And the last-check label remains visible

  Scenario: Optional providers are explicit deterministic fixtures
    Given an Electron harness uses the production preload
    When the shell requests WeRead or user application state
    Then the harness returns an explicit unconfigured or empty state
    And unavailable provider states remain subject to layout validation

  Scenario: Hidden Home fixture establishes its pointer viewport
    Given a hidden Electron window starts with one-pixel content bounds
    When the Home fixture loads the desktop before pointer checks
    Then it sets the requested content size and dispatches resize
    And the Overview accepts page swipes without source controls

  Scenario: The desk driver validates page markers without unrelated harnesses
    Given the Shell starts with its declared display pages
    When the existing E2E runner uses driver-only mode
    Then every page has one visible marker on the desk
    And the driver reports its real failures through its exit status
    And the default complete E2E still runs all child harnesses
