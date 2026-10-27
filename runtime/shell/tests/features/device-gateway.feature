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
  Scenario: Associate a Hydra controller
    Given the Bridge has a configured encrypted general peer
    When the resident selects that peer as the Hydra controller in Devices
    Then the host saves that association outside the runtime release
    And Devices shows the controller identity and application connection state
    And the existing Hydra Widget and App receive its validated telemetry
    And the association does not change gateway keys or the S3 Remote peer

  Scenario: Remove a Hydra association
    Given Devices shows a selected Hydra controller and its plant readings
    When the resident removes the Hydra association
    Then the host clears only the Hydra association
    And old controller readings cannot appear under a new identity
    And the Bridge and S3 remain available

  Scenario: Hydra telemetry expires independently
    Given the gateway remains connected and Hydra stops reporting
    When the Hydra application heartbeat expires
    Then Devices reports Hydra unavailable
    And old plant measurements remain stale rather than live
    And local watering remains under the peripheral firmware

  Scenario: Connection management cannot authorize watering commands
    Given Hydra is associated with a configured peer
    And no separately authenticated user-confirmed control action exists
    When Devices manages its connection
    Then its connection actions are association and removal
    And it does not send pump, timetable, provisioning, or OTA commands

  Scenario: Windows shares one authenticated Bridge owner
    Given a Windows x64 Shell Host and its selected NanoC6
    When Devices and installed packages request gateway access
    Then both use the authenticated local Bridge pipe
    And only the Bridge creates the C6 serial worker
    And C6 uses USB CDC while S3 control uses ESP-NOW

  Scenario: Refuse an unauthenticated Windows client
    Given the Windows Bridge owns its local pipe
    When a client omits or presents the wrong host token
    Then it receives no device snapshot or Remote state
    And no request reaches the selected gateway

  Scenario: Refuse a second Windows Bridge owner
    Given a Bridge already owns the Windows pipe
    When another Bridge starts with the same endpoint
    Then its listener fails before its serial worker starts
    And the original owner remains available

  Scenario: Windows selects the C6 Host Link explicitly
    Given the Windows Bridge has no selected gateway configuration
    When its normal startup command runs
    Then startup fails before a transport starts
    And it does not select the USB Remote adapter

  Scenario: Windows control admission precedes the C6 worker
    Given the Windows Bridge control endpoint is required
    When that endpoint cannot start
    Then Bridge startup fails and releases its data listener
    And the C6 worker does not start

  Scenario: Bound unauthenticated Windows connections
    Given the Windows Bridge accepts at most 32 channel connections
    When pending authentication and accepted clients reach that limit
    Then another client closes before the authentication timeout
    And it receives no Remote or gateway state

  Scenario: Stop while the Windows control endpoint starts
    Given the Bridge control endpoint has not completed startup
    When the Bridge stops before that endpoint returns
    Then both owned listeners close once
    And the C6 worker does not start
