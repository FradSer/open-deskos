Feature: Test tiers keep local checks fast
  Node contract checks run without a graphical Electron process.
  Electron acceptance checks start a graphical Electron process.

  Scenario: A contributor runs both tiers
    Given the Shell has Node contract tests and Electron acceptance tests
    When a contributor lists both tiers
    Then each test file belongs to exactly one tier
    And the two tiers cover every test file

  Scenario: The measured acceptance files stay out of the fast tier
    Given the three slowest Electron acceptance tests
    When a contributor runs the fast tier
    Then the fast tier excludes those three tests
    And the acceptance tier includes those three tests
    And a pure Node contract test stays in the fast tier

  Scenario: The fast tier uses more workers
    Given the acceptance tier keeps two concurrent workers on the reference host
    When a contributor runs the fast tier
    Then the fast tier uses more than two concurrent workers

  Scenario: A new Electron test file joins the acceptance tier
    Given a new test file can start a graphical Electron process
    When a contributor classifies the tests
    Then the acceptance tier includes the new file
    And the fast tier excludes the new file

  Scenario: The package exposes both tier commands
    Given a contributor works in the Shell package
    When the contributor reads the package commands
    Then a fast tier command and an acceptance tier command call the tier runner
    And the complete suite command still runs every test file

  Scenario: The reference host keeps a conservative fast tier
    Given the CM5 reference host has eight cores and a Mali GPU
    When a contributor runs the fast tier on that host
    Then the fast tier uses four concurrent workers
    And other hosts keep eight concurrent workers
    And an explicit concurrency override takes precedence
