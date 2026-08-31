Feature: Open DeskOS Remote Bridge

  Remote Bridge is a standalone Node.js user service. It owns the replaceable
  Remote Link adapter while the Display Shell remains the authority for page
  state.

  Scenario: Display Shell receives factual link state through its private local socket
    Given Remote Bridge starts in a user session with XDG_RUNTIME_DIR set
    When a Display Shell client connects to XDG_RUNTIME_DIR/open-deskos-remote/bridge.sock
    Then the socket is located below XDG_RUNTIME_DIR with mode 0600
    And the client receives a versioned JSON Lines link record
    And link state is disconnected, syncing, usb, or wireless

  Scenario: Shell state is sent to a newly reconnected wired Remote Control
    Given the Display Shell has published authoritative state with page, pages, name, canPrev, and canNext
    And the unique Open DeskOS Remote USB CDC link appears below /dev/serial/by-id
    When the USB CDC adapter reconnects
    Then Remote Bridge publishes syncing before factual usb
    And the adapter receives the latest state JSON Lines record with link wired
    And the page, pages, name, and boundary flags are preserved
    And the retained Display Shell state remains unchanged
    And a future UART and C6 Gateway adapter receives the same state with link wireless
    And the Display Shell receives factual wireless link state for that adapter

  Scenario: The bridge survives an S3 reboot and reconnects automatically
    Given the Remote Bridge user service is running
    And the USB CDC adapter is connected to the Open DeskOS Remote
    When the ESP32-S3 restarts and its /dev/serial/by-id link disappears then returns
    Then the adapter reports disconnected while the device is absent
    And the service remains running without manual intervention
    And the adapter reopens the restored unique USB CDC link
    And it sends the latest authoritative state to the restarted Remote

  Scenario: Wired Remote Control discovery is unambiguous and never relies on ttyACM numbering
    Given no unique Open DeskOS Remote device exists below /dev/serial/by-id
    When the USB CDC adapter scans for a device
    Then it reports disconnected without opening a numbered ttyACM path
    Given more than one Open DeskOS Remote device exists below /dev/serial/by-id
    When the USB CDC adapter scans for a device
    Then it remains disconnected and reports an ambiguous device reason

  Scenario: Future Remote Link adapters use the same versioned message boundary
    Given an active Remote Link adapter emits a versioned navigate message
    When Remote Bridge validates the message
    Then connected Display Shell clients receive that navigate message unchanged
    Given an adapter emits an unversioned or unsupported-version navigate message
    Then Remote Bridge discards it before it reaches the Display Shell
    And the USB CDC adapter remains replaceable by a future UART and C6 Gateway adapter
