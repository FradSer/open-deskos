Feature: Open DeskOS uses one tested Pi v1.2 runtime on each Shell Host
  Scenario: The bundled SDK version matches the declared runtime
    Given a staged Personal Bot and Hosted Pi component
    When its dependencies are installed from its frozen lockfile
    Then the declared and resolved Pi SDK version is 1.2.0
    And Durable, env, AI, Chord, and Code Mode belong to the same v1.2 release family

  Scenario: CLI version is not proof of the resident SDK version
    Given a host whose CLI is upgraded while its resident SDK is older
    When the operator checks readiness for this revision
    Then CLI and resident SDK versions are reported separately
    And old resident source is not accepted as new-candidate evidence

  Scenario: Upgrade preserves user state and idle-session boundaries
    Given a host with existing configuration, credentials and an active Shell
    When an approved Pi component upgrade is applied after coding work is idle
    Then it retains device-local configuration and persisted sessions
    And it does not restart the Shell or interrupt working coding sessions
    And it reports installed and newly started agent versions separately
