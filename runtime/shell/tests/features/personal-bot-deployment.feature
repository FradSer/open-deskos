Feature: Independent CM5 personal bot service deployment
  Scenario: Browser provisioning checks use the packaged integration
    Given a flat CM5 release with its browser feature and peripheral sources
    And an unrelated integration tree exists outside the release
    When the browser provisioning checks run from the release
    Then they read the feature inside the release
    And all browser provisioning checks pass without host installation

  Scenario: Windows preserves UTF-8 microphone names from device configuration
    Given a Windows PowerShell 5.1 host with a Chinese DirectShow microphone name
    And its device environment file is UTF-8 without a BOM
    When the Personal Bot launcher imports the device environment
    Then the microphone name reaches the recorder unchanged

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

  Scenario: The Personal Bot is a required component of the release
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

  Scenario: Enable legacy service aliases by their canonical unit identity
    Given the Personal Bot, Open DeskOS Link, Remote Bridge, and Hosted Pi task aliases link to open-deskos units
    When the CM5 installer stages or starts those services
    Then it reads each loaded unit's canonical identity before enabling it
    And it keeps the Personal Bot, Open DeskOS Link, and Hosted Pi tasks on the stable runtime path

  Scenario: Stage the canonical helper without rewriting operator configuration
    Given a host retains an earlier helper and its configured executable reference
    When the installer stages the reviewed Hosted Pi helper
    Then odk-pi-task-control uses the stable current release and private executable permissions
    And the earlier helper bytes remain unchanged
    And the existing target configuration bytes remain unchanged
    And the operator must migrate existing executable references after verifying the new helper

  Scenario: Unconfigured voice keeps the shell usable and reports its state
    Given the shell release has been activated
    And STT authentication or the default ALSA microphone is unavailable
    When the desk starts
    Then the shell remains usable without a personal bot service dependency
    And the Personal Bot reports its needs-configuration or unavailable state truthfully
    And voice configuration is read only from a device-local environment file
    And coding uses an explicitly provisioned writable checkout outside immutable releases

  Scenario: Windows runs a display client for the central Personal Agent
    Given the operator has paired the dedicated odk-cm5-agent SSH alias
    When OdkPersonalBot starts in the interactive Windows session
    Then it starts display-client.mjs without a local Personal Agent or model fallback
    And only the fixed alias and microphone settings enter the display configuration
    And provider credentials and local agent migration are not required
    And a missing entry, SSH executable, or invalid alias prevents registration
