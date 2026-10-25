Feature: Python services have independent revision environments
  Scenario: A locked Python package is prepared
    Given a service revision declares an exact Python version and a lockfile
    When the runtime prepares the revision
    Then uv validates the lockfile without changing it
    And dependencies use that revision's private virtual environment
    And the selected interpreter matches the declared patch version
    And inherited project and Python overrides cannot select another environment

  Scenario: A stale lockfile prevents installation
    Given the project dependencies differ from the locked dependencies
    When the runtime prepares the revision
    Then preparation fails before dependency synchronization
    And the lockfile remains unchanged

  Scenario: Revisions run independently
    Given two prepared revisions have different service scripts
    When each revision runs with its own command
    Then each uses its own virtual environment and service script
    And neither changes the other revision's environment
