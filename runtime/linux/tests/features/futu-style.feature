Feature: Calm and truthful Futu holdings styling
  Scenario: Three holdings show current prices
    Given Futu supplies three positions with current prices
    When the tile is rendered at compact or desktop size
    Then all three positions show symbol, current price, and daily change
    And missing or invalid prices show -- rather than a fabricated zero
    And cached prices remain visibly stale
  Scenario: Futu shares the neighboring widgets' content frame
    Given the Shell already supplies the widget inset
    When Futu is rendered beside Weather and Hydra
    Then its body does not apply a second inset
    And the primary reading and holdings use the available content width
  Scenario: Live holdings emphasize the main reading
    Given the Futu tile has live gains and losses
    When the tile is rendered
    Then the primary ratio uses the matching semantic trend color
    And holding ratios have transparent backgrounds and aligned tabular numerals
    And supporting state text is readable

  Scenario: Cached holdings do not look live
    Given a stale snapshot contains gains and losses
    When the tile is rendered
    Then both the main ratio and holding ratios use a neutral readable color
    And the stale label remains visible

  Scenario: Themes preserve compact readability
    Given the tile is displayed in Instrument, Pixel, or Border Beam
    When compact or wide geometry is used
    Then title and state text remain at least 18 pixels and holdings at least 20 pixels
    And data remains contained
    And Pixel numerals have normal letter spacing
