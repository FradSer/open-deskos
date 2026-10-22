Feature: One system-owned application lifecycle
  Scenario: Plugin CLI installs a local HTML package through the application store
    Given a local Widget/App directory with a manifest and HTML document
    When the Plugin CLI adds that directory
    Then the application store verifies its exact bytes before installation
    And the installed revision remains available without the source directory
    And a failed verification leaves the prior revision unchanged
    And symlinks, oversized files, and native plugin manifests are rejected

  Scenario: Plugin CLI manages verified installed packages
    Given a running Main Host and application control service
    When the Plugin CLI lists packages or updates or removes an installed identifier
    Then it reports the actual service result
    And updates retain verification and rollback snapshots
    And an update cannot install an unknown identifier

  Scenario: Unsupported plugin installation cannot report success
    Given native package installation and development linking are unavailable
    When the Plugin CLI receives a native package or link request
    Then it exits with failure and an explicit unavailable message

  Scenario: Plugin CLI restores a verified installed revision
    Given an installed package with a retained previous revision
    When the Plugin CLI rolls back that installed identifier
    Then the application store verifies and restores the retained revision
    And the restored bytes remain available after restart without the workspace draft
    And failed verification or missing history preserves the current revision
    And native plugin identities do not invoke package rollback

  Scenario: Agent and desktop invoke the same installer
    Given a system application store
    When a desktop intent or private control request installs a draft
    Then the same store validates and installs that identifier
    And the response reports the actual result

  Scenario: Corrupt installed state is not an empty successful catalog
    Given installed catalog data is corrupt
    When a client lists applications
    Then the application service reports unavailable
    And it does not report an empty successful installation list

  Scenario: Control transport is private and bounded
    Given the system application control socket is listening
    When an invalid command or oversized request arrives
    Then no application mutation runs
    And the connection is closed

  Scenario: Installed App pages remain reachable on the compact display
    Given a 320 pixel wide Shell with five base pages and independently installed App pages
    When the user selects an installed App page marker
    Then all page hit targets remain distinct and clear of the Pi status control

  Scenario: Voice and Shell share system workspace configuration
    Given a system runtime environment file defines ODK_WORKSPACE
    When the Shell and Personal Agent user services start
    Then both load the same shared environment file
    And bot-specific configuration remains separate

  Scenario: Installed content never exposes workspace paths
    Given an installed application revision
    When its exact local application URL is requested
    Then the system serves only that installed revision under restrictive content policy
    And an unknown or stale revision cannot read draft files
