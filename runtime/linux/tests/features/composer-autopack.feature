Feature: Desktop Grid Auto-Assembly via Manifest Contributions

  Scenario: Widget with manifest contribution preferredSpan auto-packs into free grid cell
    Given a tile plugin declares contributions with preferredSpan "1x1"
    And desktop layout does not assign explicit col and row coordinates for the widget
    When the composer builds the home grid
    Then the composer packs the widget into the first available free grid cell
    And the widget is mounted and interactive

  Scenario: Explicit coordinate layout overrides take precedence over auto-packing
    Given a tile plugin declares a preferredSpan in its manifest
    And desktop layout explicitly assigns col "2" and row "1" for the widget
    When the composer builds the home grid
    Then the widget is placed at the explicitly configured col "2" and row "1"
    And auto-packing does not overwrite the explicit placement
