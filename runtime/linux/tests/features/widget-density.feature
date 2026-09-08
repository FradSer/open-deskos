Feature: Widget content density around sixty-two percent

  Scenario: Density is measured from rendered content instead of empty containers
    Given every Home Widget has rendered its bundled fonts and current fixture state
    When the density harness measures text line boxes, icons, dials, and progress meters
    Then visual fill is the tight content envelope area divided by the Widget inner frame area
    And the preferred fill is 62 percent with an 8 percentage-point tolerance
    And empty flex containers, card backgrounds, and borders do not count as content
    And nested or overlapping content rectangles are counted only once in occupied area
    And occupied area and the largest empty vertical band are reported separately

  Scenario: Sparse corners cannot masquerade as a filled Widget
    Given tiny content appears near opposite Widget corners
    When the harness computes the tight envelope
    Then a large envelope does not hide low occupied area or a large empty band
    And the Widget fails the density guard when occupied area is below 20 percent of its inner frame
    Or when a full-width empty vertical band exceeds 28 percent of its inner height

  Scenario: Density violations remain actionable
    Given the shell runs at 1920 by 1280, 1920 by 1080, or compact development sizes
    When the harness inspects all ten declared Widgets
    Then every Widget reports its identity, bounds, envelope fill, occupied area, empty band, and target deviation
    And a missing Widget or clipped content fails the harness
    And clipping by any intermediate overflow container is detected even when the original content lies inside the card
    And asymmetric borders are measured on each side independently
    And strict mode exits nonzero when a Widget is outside the configured density band
    And report-only mode still includes the same violations without claiming they passed
    And an optional capture directory receives a Home screenshot for visual comparison
    And every captured image is normalized and checked against its requested CSS-pixel dimensions
    And each Widget capture is completely inside the viewport after scrolling

  Scenario: Denser content remains truthful
    Given a Widget has little source data or an unavailable capability
    When its composition is made denser
    Then existing text, numerals, and icons may scale and regroup without fabricated information
    And content remains readable and does not overlap or escape its card
    And live and unavailable fixtures are measured independently
    And single-digit dates, double-digit dates, and year-end 100 percent values are measured with a deterministic clock
    And wider numeric values adapt their type size without clipping
