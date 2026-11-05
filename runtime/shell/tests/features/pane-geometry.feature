Feature: The State Bar, Agent header, and Widget canvas share one tight geometry

  The State Bar band and the desk start at the same edge. The Agent avatar is
  never clipped by the State Bar or its own pane. The 3x2 Widget canvas fits
  inside the paging viewport, and the Page Controller sits directly below it
  without a tall empty row.

  Scenario: The State Bar band matches the desk top edge
    Given the panel uses the shared Widget geometry
    Then the State Bar band ends where the desk begins
    And no dead strip separates the two

  Scenario: The Agent avatar stays inside its pane
    Given the Agent header sits below the State Bar
    Then the avatar is not clipped by the pane or the State Bar
    And the framed identity capsule keeps its border and radius

  Scenario: The Widget canvas and the Page Controller fit the right pane
    Given the right pane shows a 3x2 Widget page
    Then the last Widget row stays inside the paging viewport
    And the Page Controller sits below the viewport without a tall empty row
