Feature: Pre-order countdown widget
  Scenario: Reading page hosts WeRead beside the pre-order countdown
    Given the home layout is loaded
    Then the reading page hosts the WeRead widget spanning three columns and two rows anchored top-left
    And the reading page hosts the pre-order widget spanning two columns and two rows beside WeRead

  Scenario: Pre-order widget counts down in days and hours
    Given the pre-order start is in the future
    When the pre-order widget ticks
    Then it displays the remaining time as days and hours

  Scenario: Pre-order widget states its start honestly after launch
    Given the pre-order start has passed
    When the pre-order widget ticks
    Then it displays that pre-order is open instead of a countdown

  Scenario: Hero figure is art-directed rather than stretched
    Given the pre-order widget renders its hero photo
    Then the figure keeps the source aspect ratio with a cover crop
    And the figure excludes the empty studio floor below the device

  Scenario: Countdown reads from the instrument surface, not from the photo
    Given the pre-order widget is rendered
    Then the countdown sits below the figure on the tile surface behind a hairline stroke
    And the widget adds no scrim gradient and no drop shadow to the photo

  Scenario: Pixel theme scales the caption instead of pinning it at the floor
    Given the shell is using the Pixel theme
    When the pre-order widget renders its caption
    Then the caption size follows the tile with a 12px floor rather than a flat 12px
    And the bitmap face stays legible as pixel art at desktop density

  Scenario: Pre-order content stays readable inside its tile at every density
    Given the pre-order widget is rendered in a wide or compact grid
    Then its hero figure, countdown, and start label remain inside the tile bounds
    And every rendered label keeps at least a 12px font size
