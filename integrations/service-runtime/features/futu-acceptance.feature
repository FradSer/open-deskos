Feature: Real Futu worker packages use the generic service runtime
  Scenario: A locked Python Futu package runs through the foreground supervisor
    Given an explicitly selected real Futu source package and private test configuration
    When the generic manager installs and enables its locked revision
    Then a real foreground supervisor starts the installed worker
    And its local control health command succeeds without provider authentication
    When the generic manager disables the service
    Then SIGTERM releases the worker and its management endpoint
    And installed revisions and private configuration remain available for rollback
    And no systemd acceptance is claimed by the test controller

  Scenario: A cached Docker Futu package uses the complete manager lifecycle
    Given an explicitly selected Futu package with a cached immutable ARM64 image
    When the generic manager installs and enables that package
    Then its owned container passes the actual control health command
    When the manager disables the service
    Then it releases the owned container and retains its revision
    And the released container reports absent and cannot supply current health
    And no OpenD gateway or production account is contacted

  Scenario: An authorized CM5 deployment preserves the real data chain
    Given existing OpenD credentials and an active Futu worker on CM5
    When the operator migrates it to the independent service manager
    Then the exact locked SDK authenticates with that OpenD gateway
    And its position identity fingerprint matches the actual Personal Agent data tool
    When Python and Docker services stop, restart, update, and roll back
    Then stopped services cannot report live data
    And each activation supplies a newer provider reading through the Shell registry
    And process or container identities match the selected revision
    And Docker updates use different immutable image identities
    And the original Shell release remains selected
    And final activation retains a verified rollback revision without duplicate workers

  Scenario: A rejected CM5 update restores the current live worker
    Given an authorized live Python Futu revision and its retained rollback revision on CM5
    When a candidate worker starts but its readiness probe always fails
    Then the update command fails after bounded candidate cleanup
    And a private marker identifies the candidate probe that ran
    And the current revision and rollback selection remain unchanged
    And the restored worker has a new verified process generation
    And the restored current worker supplies a reading newer than the failed operation
    And the legacy worker remains disabled without duplicate managed containers

  Scenario: Local worker readiness rejects slow control replies
    Given a local control peer sends a reply one byte at a time
    When the total control probe exceeds two seconds
    Then the worker is not ready even if each individual read returned promptly

  Scenario: Source packaging rejects path aliases
    Given a source or destination parent is a symlink alias
    When an operator builds the credential-free worker package
    Then packaging fails before publishing the destination
