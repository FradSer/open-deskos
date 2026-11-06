Feature: CM5 acceptance reports the configured Pi Sessions source

  The report inspects the environment that the kiosk service loads.

  Scenario: A remote source is declared in runtime.env
    Given runtime.env declares ODK_PI_SSH_HOST
    And systemd does not repeat the variable in Environment
    When the CM5 acceptance report checks the remote source
    Then it reports whether that host answers SSH
