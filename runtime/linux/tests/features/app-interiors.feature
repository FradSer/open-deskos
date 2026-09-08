Feature: Built-in App interiors

  Scenario: Built-in views expose a coherent semantic interior
    Given a user opens a built-in Calendar, Clock, Pomodoro, or Year progress view
    Then the App retains its runtime surface
    And its title is inside an App surface header with an App surface heading
    And explanatory copy uses the App detail anatomy
    And truthful live or pending information uses the runtime value or runtime state anatomy
    And Pomodoro retains its Start timer control

  Scenario: Built-in view search has a visible accessible label
    Given a user opens Built-in views
    Then the App retains its runtime surface and App surface header
    And the search input has a visible Search built-in views label associated with it
    And the search input and results use the shared App search and App list anatomy
    And loading and error status remain announced to assistive technology
