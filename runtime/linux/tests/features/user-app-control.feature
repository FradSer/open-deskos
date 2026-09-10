Feature: One system-owned application lifecycle
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

  Scenario: Fifth page remains reachable on the compact display
    Given a 320 pixel wide Shell with six pages
    When the user selects the Your apps page marker
    Then all page hit targets remain distinct and clear of the Pi status control

  Scenario: Voice and Shell share system workspace configuration
    Given a system runtime environment file defines ODESK_WORKSPACE
    When the Shell and Voice Agent user services start
    Then both load the same shared environment file
    And voice-specific configuration remains separate

  Scenario: Installed content never exposes workspace paths
    Given an installed application revision
    When its exact local application URL is requested
    Then the system serves only that installed revision under restrictive content policy
    And an unknown or stale revision cannot read draft files
