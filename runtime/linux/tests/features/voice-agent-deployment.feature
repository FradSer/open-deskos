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

  Scenario: Voice activation cannot block the shell
    Given the shell release has been activated
    And STT authentication or the default ALSA microphone is unavailable
    When the independent voice user service is installed and restarted
    Then the shell remains usable without a voice service dependency
    And voice configuration is read only from a device-local environment file
    And coding uses an explicitly provisioned writable checkout outside immutable releases
