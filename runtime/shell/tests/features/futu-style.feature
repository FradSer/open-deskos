Feature: Calm and truthful Futu holdings styling

  # The expanded row is kept as long as it genuinely fits, and the break point is
  # measured rather than chosen per device. At the 20px holdings floor the three
  # values need about 207px in the Pixel theme and about 256px in Instrument, while
  # symbol and change together need about 127px and 158px. The two supported hosts
  # compute very different cells from one layout model — a 1280x776 handheld lands
  # on a 186px cell with 152px of content, and a 1920x1280 reference host lands on a
  # 340px cell with 306px — so the narrow cell is on the collapsed side of that
  # break and the wide cell is on the expanded side. The tile measures its own row
  # and neither host is named anywhere in it.

  Scenario: Three holdings show current prices
    Given Futu supplies three positions with current prices
    When the tile is rendered at a cell wide enough for symbol, price, and daily change
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

  Scenario: State captions stay whole in a narrow cell
    Given every reachable tile state in a cell too narrow for long captions
    Then each state caption renders on one line without an ellipsis
    And each caption still says what is true about the holdings

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

  Scenario: A narrow cell shows every holding whole instead of a clipped symbol
    Given a holdings snapshot whose symbol, price, and daily change do not fit on one line
    When the tile is rendered in a cell too narrow for all three values
    Then every holding shows its whole symbol and its whole daily change
    And no holding row overflows and no symbol is ellipsized
    And the expanded row is kept wherever all three values genuinely fit
    And holdings type is not reduced below the readable data floor to make room

  Scenario: A holding that leaves out its price still states it
    Given a holding whose price is not part of the narrow cell's row
    When the row is announced
    Then its symbol, price, and daily change are all present in its accessible name

  Scenario: The layout follows the cell, not the host
    Given the same holdings rendered in a narrow cell and in a wide cell
    When both are measured
    Then each cell carries the layout its own width supports
    And the choice is made from measured content rather than from a device identity
