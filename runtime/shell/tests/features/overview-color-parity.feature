Feature: Overview uses the same colors as Widgets and Apps

  The Overview reads values from the same sources as the Widgets. Its value and
  state colors come from the shared accent tokens. It has no separate mixed
  status palette.

  Scenario: Overview state colors match the Widget accent tokens
    Given the Overview shows an upward and a downward value
    Then the upward value uses the same green token as a Widget gain
    And the downward value uses the same red token as a Widget loss
    And no Overview value uses a mixed status color

  Scenario: Overview source icons keep their category colors
    Given the Overview shows several sourced facts
    Then the icons keep their distinct category colors
    And the icons do not use the fact text color
