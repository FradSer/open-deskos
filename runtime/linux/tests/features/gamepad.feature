Feature: The owner navigates the desk with a gamepad

  The Windows handheld is a computer with an Xbox-style pad attached, and its owner
  operates it the way a console is operated: the directional pad moves, A confirms,
  B cancels, the shoulders change page, and one button summons voice. A gamepad is
  not the Remote Control — that is the CM5's own touchscreen device — but it is a
  second surface for the same navigation intents, so the desk reads it in the Shell
  rather than in a host-specific module and a second host costs the first nothing.

  Scenario: The directional pad moves within the page and the shoulders change page
    Given a gamepad with a standard mapping
    When its owner presses the directional pad
    Then the desk receives the movement intent that direction stands for
    When its owner presses the right shoulder
    Then the desk shows the next page
    When its owner presses the left shoulder
    Then the desk shows the previous page

  Scenario: The shoulders change page while a control holds focus
    Given a gamepad with a standard mapping
    And a page whose control holds focus
    When its owner presses the right shoulder
    Then the desk shows the next page

  Scenario: A confirms and B cancels
    Given a gamepad with a standard mapping
    And a page the desk can focus
    When its owner presses A
    Then the desk focuses that page
    When its owner presses B
    Then the desk leaves that page's focus

  Scenario: Y summons voice through the desk's own microphone intent
    Given a gamepad with a standard mapping
    When its owner presses Y
    Then the desk receives the microphone intent the Remote Control's MIC produces

  Scenario: Holding a direction keeps moving
    Given a gamepad with a standard mapping
    When its owner holds the directional pad
    Then the desk moves once
    And it moves again after a first delay
    And it keeps moving while the direction is held

  Scenario: The desk states a connected gamepad, and stays quiet without one
    Given no gamepad
    Then the desk states no gamepad
    When a gamepad with a standard mapping connects
    Then the desk states the connected gamepad

  Scenario: A pad the desk cannot read is stated but drives nothing
    Given a gamepad whose mapping is not standard
    Then the desk states the connected gamepad
    And the desk receives no movement from it

  Scenario: An unreadable pad never hides a readable one
    Given a gamepad whose mapping is not standard
    And a gamepad with a standard mapping at a later index
    Then the desk receives movement from the readable one