Feature: Immutable runtime release deployment
  Device preflight must validate a staged candidate exactly as the kiosk
  session will run it, without depending on ambient installer environment.

  Scenario: Device preflight uses the kiosk graphical session
    Given a staged candidate release
    And a kiosk user with an active graphical session
    When the updater runs release preflight
    Then the Electron verifier inherits the session display
    And activation never depends on ambient SSH environment variables

  Scenario: Staged candidate carries its peripheral and experiment sources
    Given a staged candidate release
    When the installer seals the candidate
    Then the candidate contains the staged peripherals, integrations, and experiments trees
    And device preflight resolves repository sources from inside the candidate
    And preflight never reads ambient copies outside the candidate
