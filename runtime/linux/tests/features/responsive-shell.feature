Feature: The desk is readable on the panel it is drawn on

  # Verified by `pnpm geometry`, which builds the stylesheet and then runs the
  # responsive matrix gate, the density gate, and the two per-Widget composition
  # harnesses. A gate nothing invokes would be a report.
  #
  # The Cell is the unit of adaptation. The layout model gives 348px cells at
  # 1920x1280, 186px at 1280x776, 282px at 636x1087 and 360px at 400x700, because
  # a small window lays out fewer columns. Window width therefore predicts nothing
  # about the space a Widget gets, and this feature is verified only at the two
  # sizes the desk is responsible for.

  Scenario: Every reading is drawn in full on the reference panel
    Given the widest holdings, titles, and prompts the feeds can carry
    When the desk is drawn at 1920x1280 in every theme
    Then no text on any page is clipped by its own box
    And no content is hidden beyond reach
    And no type falls below the readable floor

  Scenario: Every reading is drawn in full on the handheld panel
    Given the widest holdings, titles, and prompts the feeds can carry
    When the desk is drawn at 1280x776 in every theme
    Then no text on any page is clipped by its own box
    And no content is hidden beyond reach
    And no type falls below the readable floor

  Scenario: Holdings are told apart on the narrowest promised panel
    Given four positions with four-figure prices and two-digit changes
    When the holdings tile is drawn at the handheld cell
    Then every position shows its whole symbol and its whole daily change
    And the price that the row cannot carry is still stated in the row's accessible name

  Scenario: A tile that shows a subset says so
    Given more positions than the tile has room to draw
    When the holdings tile is drawn
    Then it states how many positions it is not showing

  Scenario: A long goal is bounded rather than lost
    Given a session whose goal is longer than one line of the tile
    When the session tile is drawn at either promised size
    Then the goal wraps and is bounded
    And the session's state, workspace, and activity remain readable

  Scenario: Type never falls below the readable floor
    Given a status label the narrow cell would otherwise scale down
    When the tile is drawn at the handheld cell
    Then the label renders at or above the caption floor

  Scenario: A declared span is honored when the cell can hold it
    Given a Widget that declares a Minimum Readable Cell
    When the page is drawn where the resulting cell meets that minimum
    Then the declared span is kept

  Scenario: A declared span is refused when the cell cannot hold it
    Given a Widget that declares a Minimum Readable Cell
    When the page is drawn where the resulting cell is smaller than that minimum
    Then the span is dropped rather than drawn too small to read
    And the Widget still renders at the cell it is given

  Scenario: A smaller window is not a worse desk
    Given a window narrower than a promise on the reference host
    When the page is drawn
    Then its declared composition is kept wherever the grid can satisfy it
    And the result is chosen from cell size rather than from window width

  Scenario: A glanceable Widget does not scroll
    Given a glanceable Widget whose content exceeds its cell
    When it is drawn at the smallest promised cell
    Then it is not scrollable
    And everything it hides is a whole item it states the count of

  Scenario: An interactive App page still scrolls
    Given an App page whose content exceeds its viewport
    When it is drawn at the smallest promised size
    Then its overflowing content is reachable by scrolling
