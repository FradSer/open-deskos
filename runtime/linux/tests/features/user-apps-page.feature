Feature: Installed packages belong on the desktop
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
