Feature: Widget-only interaction (no App layer)
  Widgets are the sole interactive surface. Tapping a widget triggers its
  inline action. There is no fullscreen App, no screen transition, and no
  hero_navigator.

  Scenario: Widget tap triggers inline action
    Given a widget whose plugin defines an on_click handler
    When the user taps the widget
    Then the on_click handler executes
    And no fullscreen App screen is created
    And no screen transition occurs

  Scenario: Display-only widget does not navigate
    Given a widget whose plugin has no on_click handler
    When the user taps the widget
    Then no action is taken
    And no fullscreen App screen is created

  Scenario: Bottom peek is an empty container
    Given the Shell is showing the home screen
    Then the bottom peek strip is visible as an empty card
    And the peek contains no interactive content
    And tapping the peek does nothing
