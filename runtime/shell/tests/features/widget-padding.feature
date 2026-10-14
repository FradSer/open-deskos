Feature: Consistent widget content insets

  Scenario: Every grid widget uses one responsive content inset
    Given every declared grid widget has a populated reading
    When the widget is rendered at reference, handheld, and compact cell sizes
    Then its text and data stay within the shared 16 to 28 pixel adaptive inset
    And nested widget wrappers do not add another outer inset
    And deliberate edge-to-edge artwork keeps its labels and values on the shared inset

  Scenario: Weather and Hydra use the shared frame without extra padding
    Given Weather and Hydra render their live readings
    When their content fills each measured cell
    Then Weather keeps block padding below one pixel inside the widget frame
    And Hydra uses a cell-based inset for a plant-only layout

  Scenario: Hydra keeps the unconfigured label inside its narrow plant cell
    Given the plant-only layout uses a 116 by 120 pixel cell
    And the Hydra bridge is unconfigured
    When the widget displays its source state
    Then the full label stays inside the card with a 12 pixel compact inset

  Scenario: Home summary aligns with widget content
    Given the Home summary and its widgets are visible
    When the summary is rendered above the widget grid
    Then its leading and trailing content use a compact adaptive inset
    And Pixel uses a smaller inset when Zpix needs the extra CJK line width
    And long CJK summaries still fit the handheld card
