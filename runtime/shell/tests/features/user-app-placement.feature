Feature: Verified widgets share desktop grids
  Scenario: Install on an exact second or third page rectangle
    Given the desktop layout includes occupied built-in grid cells
    When a verified widget is installed with a free page and grid span
    Then its placement is persisted independently of its revision
    And the desktop listing reports page numbers and occupied cells

  Scenario: Move without overwriting another instrument
    Given an installed widget on Home
    When it is moved to a free span on Reading
    Then its revision stays unchanged through restart update and rollback
    And occupied out-of-bounds and non-grid targets are rejected without changing placement

  Scenario: Assign unplaced widgets without a collection page
    Given installed widgets have no placement
    When the catalog is listed
    Then available grid cells are assigned and persisted without collisions
    And a full desktop is reported explicitly on each unplaced widget
    And removal remains available to recover capacity

  Scenario: Persisted placement corruption fails closed
    Given a catalog placement is missing a coordinate, valid page identifier, or grid line
    When the installed catalog is read
    Then corrupt catalog metadata is rejected before presentation

  Scenario: Unavailable geometry is one widget's problem, not the catalog's
    Given a persisted placement now overlaps a built-in tile or exceeds the grid
    When the installed catalog is read
    Then that widget reports its placement error
    And its revision, bytes, and removal stay available
    And no other installed package is hidden by it
    And the error clears once a layout leaves the cell free again

  Scenario: A conflicted widget keeps its placement through revision changes
    Given an installed widget has a stored placement that a new built-in tile occupies
    When the widget is updated or rolled back
    Then its revision bytes change or restore while its stored placement stays unchanged
    And the occupied placement remains an explicit rendering error

  Scenario: An App update to a Widget receives a grid cell
    Given an installed App has no desktop placement
    When its draft changes kind to Widget and is updated
    Then the Widget receives the first free grid cell

  Scenario: Stored geometry survives a layout release
    Given a Widget's stored page or grid span is unavailable in the current layout
    When the Widget is updated or rolled back
    Then its stored geometry remains unchanged and the placement error stays per-widget

  Scenario: Concurrent placements cannot overlap
    Given two widget drafts target one free cell
    When both are installed concurrently
    Then exactly one installation succeeds
