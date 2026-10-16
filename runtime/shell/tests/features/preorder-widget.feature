Feature: Pre-order countdown widget
  Scenario: The pre-order countdown owns a three-by-three canvas
    Given the desktop layout loads
    Then the Pre-order page hosts only the pre-order tile
    And that tile spans three columns and three rows from the top-left
    And the Desk page keeps the Hydra tile

  Scenario: Countdown proportions follow the golden ratio
    Given the pre-order tile is rendered on the Pre-order page
    Then the day and hour units are the numerals divided by phi
    And the countdown caption scales with the tile instead of sitting at the text floor