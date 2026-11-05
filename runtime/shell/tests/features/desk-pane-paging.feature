Feature: The right pane keeps its Overview while the 3 by 2 Widget area pages

  The right pane has a fixed Overview above a three-column by two-row Widget
  area. Horizontal navigation cycles only through the Widget pages below that
  Overview. Opening any Widget still enters its App.

  Scenario: Every paging page uses the shared three by two Widget area
    Given the Shell has the Overview above the right pane Widget area
    Then Home, Hydra, and Reading are grid pages with two Widget rows
    And Hydra and Reading place their Widget inside the shared three by two area
    And the Overview is not a member of any paging page

  Scenario: Hydra and WeRead readings are visible on their own paging pages
    Given the right pane shows a three by two Widget page
    When the Shell reports a live Hydra projection
    Then the Hydra Widget has its own paging page and can render that reading
    When the Shell reports a WeRead highlight
    Then the WeRead Widget has its own paging page and can render that highlight
    And both Widgets keep their App entry

  Scenario: Horizontal navigation leaves the Overview in place
    Given the right pane shows the Home three by two Widget page
    When bounded paging advances to the next Widget page
    Then the Overview stays in the right pane
    And only the three by two Widget area below it changes

  Scenario: The Agent avatar sits closer to the State Bar
    Given the Personal Agent header occupies the left pane
    Then the avatar top inset is smaller than the previous six pixel gap
    And the framed identity capsule keeps its shared border and radius

  Scenario: Finished proposals do not become the Agent identity state
    Given a proposal has finished with a dismissed, expired, or completed state
    When the Personal Agent capsule reports its state
    Then the capsule does not show that finished proposal as its own state
    And an active proposal in progress or awaiting a result still reports its state
    And the framed identity capsule keeps its name and status

  Scenario: The Agent pane hides Widget content while the right pane scrolls
    Given the right pane Widget area is scrollable
    When a Widget page scrolls or overflows toward the left pane
    Then no Widget content is visible inside the Personal Agent pane
    And the left pane keeps its own opaque surface and border

  Scenario: The keyboard composer centers its message like Tap to talk
    Given the Personal Agent composer is in keyboard mode
    Then the Message placeholder is centered as Tap to talk is centered in voice mode
    And the typed message stays centered while it is a single line

  Scenario: Overview weekday and date type reads larger at a glance
    Given the Overview shows its weekday and date line
    Then the weekday and date type are larger than their previous scale
    And the narrative keeps its own fitted reading size
