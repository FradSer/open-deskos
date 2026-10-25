Feature: Shared Bridge device access
  # Creation contract: source = the sole Bridge gateway owner and authenticated Remote session.
  # Identity: odk.source.device-gateway and odk.app.devices; entry = peripheral State Bar button and Built-in views catalog.
  # Lifecycle: Bridge owns the serial worker; Shell source and App own only their client subscriptions.
  # Layout: existing App surface; no desktop Cell or page order changes.
  # Typography/theme: semantic tokens, 14px minimum, no icon required.
  # Evidence: Bridge contracts, actual Electron themes, and separately authorized CM5 checks.

  Scenario: Devices shares the existing Remote client
    Given the Remote Link plugin supplies one Bridge client
    When the Devices source starts and the App refreshes
    Then the source uses that same client
    And it does not enumerate or open a serial port

  Scenario: Gateway and Remote readiness have different evidence
    Given NanoC6 has a valid live firmware handshake
    And S3 has not acknowledged the complete Shell state
    When Devices renders its snapshot
    Then NanoC6 is connected
    And S3 reports disconnected or synchronizing
    And S3 becomes ready only after the current application state acknowledgement

  Scenario: Bridge loss invalidates the displayed session
    Given Devices displays a ready S3
    When the Bridge connection or Remote heartbeat expires
    Then S3 is not shown as ready
    And old events are not displayed as current measurements
    And reconnect does not replay an action

  Scenario: Open Devices from the desktop
    Given the Shell desktop is visible
    When the peripheral State Bar button receives a click or keyboard activation
    Then the Devices App opens through the App platform
    And closing the App restores the desktop

  Scenario: Devices fixture retains the Personal Agent bridge
    Given the Devices native fixture uses the current Shell preload
    When the renderer requests Agent status and consumer readiness
    Then both requests reach the fixture handlers
    And no graphical window is required to verify this interface

  Scenario: No device selection
    Given no Bridge gateway configuration exists
    When the Devices App reads its state
    Then the state is unconfigured
    And the Shell starts no serial worker

  Scenario: Compatible gateway
    Given an explicitly selected USB serial identity
    When its versioned firmware handshake succeeds
    Then the App displays its actual MAC address, radio channel, and peer count
    And the host can request a bounded USB ping

  Scenario: Refuse incompatible and malformed replies
    Given a selected serial worker
    When a reply has an unknown version, invalid UTF-8, or an oversized record
    Then it cannot complete a request or publish live state
    And the parser can accept the next complete valid record

  Scenario: Radio delivery does not certify an application result
    Given an encrypted configured peer
    When a bounded payload receives an ESP-NOW MAC receipt
    Then the result identifies MAC receipt only
    And the App does not claim application acknowledgement

  Scenario: Removal and reconnection
    Given an active gateway session with a pending request
    When its worker exits or the device disconnects
    Then pending work ends without replay
    And the Bridge owns the later handshake
    And unrelated Shell input remains available

  Scenario: Trusted Shell frame owns device actions
    Given an unrelated frame without the trusted Shell broker
    When it calls the gateway IPC channel
    Then the host refuses the call before device I/O

  Scenario: Devices App release
    Given a Devices App refresh is pending
    When its surface closes
    Then its late reply cannot change the released surface
    And polling stops

  Scenario: General App traffic cannot forge Remote control
    Given the S3 peer is reserved for Remote control
    When any App sends an arbitrary payload to that peer
    Then the Bridge rejects the send before radio transmission
    And general peer packets cannot become Shell navigation

  Scenario: Shared Bridge fixture supports both source layouts
    Given repository and flattened release test directories
    When the device facade shares a private Bridge connection
    Then both layouts receive Remote input and correlated device replies
    And all layout fixture paths stay inside their temporary root
    And the nearest release entry takes priority over an outer copy
    And a missing dependency inside the selected Bridge remains an error
