Feature: Surface matrices keep revision acceptance fast
  A revision acceptance test checks update, rollback, and removal across four separate Electron processes.
  A full-matrix gate checks every Cell, theme, size, and reading state.

  Scenario: A contributor runs revision acceptance
    Given revision acceptance launches four Electron processes for each surface
    When a contributor runs the default acceptance suite
    Then each process renders one representative combination
    And the test still compares rendered consumers across all four revisions
    And the revision lifecycle assertions stay unchanged

  Scenario: A contributor runs the full-matrix gate
    Given the Hydra, Weather, and WeRead rendering fixtures own the complete matrices
    When a contributor runs the full-matrix gate
    Then each fixture renders every Cell, theme, size, and reading state
    And the gate reports the original matrix counts
    And each revision compares the complete consumer set

  Scenario: The matrix helper keeps every combination
    Given a fixture lists several combinations
    When the matrix helper receives no representative request
    Then it returns every combination in the original order

  Scenario: The matrix helper selects one representative combination
    Given a fixture lists several combinations
    When the matrix helper receives a representative request
    Then it returns the first combination
    And it leaves the source list unchanged

  Scenario: The package exposes the full-matrix gate
    Given a contributor works in the Shell package
    When the contributor reads the package commands
    Then a full-matrix command runs the three rendering tests and three revision tests
    And the complete suite command still runs every test file

  Scenario: A nightly gate restores the full matrix across revisions
    Given revision acceptance uses one representative combination by default
    When the nightly gate runs
    Then every Cell, theme, size, and reading state renders in each Electron process
    And each revision compares the complete consumer set
    And the gate lists all six rendering and revision tests

  Scenario: The nightly gate has a scheduled entry point
    Given a contributor schedules the full-matrix gate
    When the contributor reads the workflow
    Then a nightly schedule and a manual dispatch run the gate command

  Scenario: The nightly gate configures the Electron sandbox for CI
    Given the CI runner installs Electron as an unprivileged user
    When the workflow prepares the full-matrix step
    Then it sets the SUID sandbox helper to root ownership and mode 4755
    And the gate does not pass a no-sandbox argument to Electron
