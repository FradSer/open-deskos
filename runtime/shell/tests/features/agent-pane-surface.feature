Feature: The Agent pane has no flat fill and the State Bar keeps a tight band

  The Personal Agent pane reads against the same desktop material as the rest of
  the panel. It never paints a flat solid color behind the conversation. The
  State Bar keeps a tight vertical band without changing the Widget geometry.

  Scenario: The Agent pane clips scrolling Widgets without a flat fill
    Given the right pane Widget area can scroll
    Then the Agent pane clips its content and owns its stacking layer
    And the Agent pane has no solid background color
    And the pane keeps its separating border

  Scenario: The State Bar band tightens without moving the Widget canvas
    Given the panel uses the shared Widget geometry
    Then the State Bar is shorter than the geometry status height
    And the desk still starts at the geometry status height
    And the shortened band keeps its frosted structural material

  Scenario: An open Widget App hides the fixed Overview
    Given the right pane shows the fixed Overview above the Widget pages
    When a Widget opens its App
    Then the Overview is not visible behind the App
    And the paging track is not visible behind the App
    When the App returns to its source Widget
    Then the Overview is visible again

  Scenario: A shortened WeRead tile keeps its excerpt scrollable
    Given WeRead occupies the shared three-by-two Widget area
    When the excerpt is taller than its shortened content box
    Then the excerpt owns a focusable scroll region above the App launcher
    And a pointer at the excerpt can reach the excerpt instead of the launcher
