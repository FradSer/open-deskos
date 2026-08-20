Feature: Home and App chrome visual polish
  The stable pager keeps the Home widgets and App chrome legible and immediately
  understandable on the P4 panel.

  Scenario: OpenCode primary-window metrics follow the card's left edge
    Given the Shell is showing the OpenCode Go quota card
    When the remaining percentage and reset or five-hour-window copy are rendered
    Then both values share the card content's left edge
    And neither value is horizontally centered as a hero metric

  Scenario: Pomodoro presents a complete readable countdown
    Given the Shell is showing the Home Pomodoro widget
    When the remaining time is 25 minutes and 0 seconds
    Then the countdown displays the complete "25:00" value inside its ring
    And the red progress ring has more visual area than the countdown text
    And the target font is measured against the full "88:88" probe inside its fixed text box
    And the drag-time countdown uses the same bounds as the resting countdown

  Scenario: Every App frame has a clear responsive Back control
    Given an App frame is open from any Home or Peek entry point
    When its shared Back control is rendered and pressed
    Then a Tabler filled left arrow is visible at the leading edge
    And the "Back" label is centered within the control
    And the pressed state changes only the fill, without changing its geometry
