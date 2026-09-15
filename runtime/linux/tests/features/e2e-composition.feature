Feature: E2E validates the current declarative desktop
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
    And WeRead exposes its highlight state and Pre-order exposes its countdown

  Scenario: Consecutive Remote navigation preserves distinct input
    Given the pager is on Home
    When two next navigation events arrive consecutively
    Then the pager advances through Reading to Pi Sessions

  Scenario: Required shell content produces actionable regression failures
    Given the Electron shell has mounted its current declarative desktop
    When E2E reads required clock, dashboard, widget and app content
    Then each required selector resolves to a mounted element
    And a missing element reports its selector instead of an anonymous null textContent error

  Scenario: Unconfigured quotas remain truthful in the current Usage page
    Given the quota service fixture is not configured
    When E2E opens Usage and refreshes quotas
    Then the live quota metrics region explains that actual quotas have not been retrieved
    And no account cards, quota meters or fabricated percentages are rendered
    And the last-check label remains visible

  Scenario: Optional providers are explicit deterministic fixtures
    Given an Electron harness uses the production preload
    When the shell requests WeRead or user application state
    Then the harness returns an explicit unconfigured or empty state
    And unavailable provider states remain subject to layout validation
