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
    Given a catalog placement is missing a coordinate or is not a grid line
    When the installed catalog is read
    Then corrupt catalog metadata is rejected before presentation

  Scenario: Unavailable geometry is one widget's problem, not the catalog's
    Given a persisted placement now overlaps a built-in tile or exceeds the grid
    When the installed catalog is read
    Then that widget reports its placement error
    And its revision, bytes, and removal stay available
    And no other installed package is hidden by it
    And the error clears once a layout leaves the cell free again

  Scenario: Concurrent placements cannot overlap
    Given two widget drafts target one free cell
    When both are installed concurrently
    Then exactly one installation succeeds
