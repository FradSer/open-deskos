Feature: Pre-order countdown widget
  Scenario: Reading hosts the pre-order tile beside WeRead
    Given the reading page is loaded
    Then it hosts the WeRead tile and the pre-order tile side by side

  Scenario: Countdown proportions follow the golden ratio
    Given the pre-order tile is rendered on the reading page
    Then the day and hour units are the numerals divided by phi
    And the countdown caption scales with the tile instead of sitting at the text floor
