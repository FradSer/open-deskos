Feature: Independent CM5 voice service deployment
  Scenario: Stage voice code without device credentials or host dependencies
    Given a development checkout containing the voice integration
    When a CM5 release is staged
    Then integration node_modules and private environment and Pi auth files are excluded

  Scenario: Package the resident service with the immutable release
    Given a CM5 release candidate and voice integration source
    When the installer prepares the release
    Then voice production dependencies are installed with the frozen lockfile
    And voice source is included before release validation and activation

  Scenario: Unsupported Node is rejected before preparing voice code
    Given the selected kiosk Node is older than 22.19.0
    When the installer prepares the release
    Then preparation fails with an explicit minimum-version diagnostic
    And the active release is not changed

  Scenario: The Voice Agent is a required component of the release
    Given a release candidate and a host where the voice component cannot be installed
    When the installer stages the required components
    Then the installation fails naming the voice component and its device-local configuration file
    And the release is not reported as successfully installed
    And the active release is unchanged

  Scenario: Required component units are staged before activation
    Given a release candidate carrying the voice integration and the Hosted Pi control unit
    When the installer stages the required components
    Then each unit is written from the candidate template on the stable runtime path
    And a unit that cannot be staged fails the installation
    And the required services start only after activation selects the release
    And a host without a Hosted Pi configuration keeps that unit staged and stopped

  Scenario: Unconfigured voice keeps the shell usable and reports its state
    Given the shell release has been activated
    And STT authentication or the default ALSA microphone is unavailable
    When the desk starts
    Then the shell remains usable without a voice service dependency
    And the Voice Agent reports its needs-configuration or unavailable state truthfully
    And voice configuration is read only from a device-local environment file
    And coding uses an explicitly provisioned writable checkout outside immutable releases
