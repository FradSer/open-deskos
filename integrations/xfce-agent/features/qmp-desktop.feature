Feature: Anonymous virtual desktop control
  The XFCE Agent owns screenshots and input for one isolated virtual machine.
  The coordinator receives task results without desktop input authority.

  Scenario: Capture the virtual machine display
    Given a QEMU display with a known pixel pattern
    When the driver captures a frame
    Then the PNG contains the same display dimensions and pixels

  Scenario: Cancel an input while a key is held
    Given an input request that holds a key
    When the request is cancelled
    Then the driver releases every held key before it returns

  Scenario: Refuse stale or unsupported actions
    Given a fixed desktop viewport
    When an action contains invalid coordinates or an unsupported shortcut
    Then the driver sends no input to QEMU

  Scenario: Keep a private intervention out of model evidence
    Given an anonymous task that reaches a synthetic login page
    When the operator enters private mode
    Then model observation and evidence capture stop before operator input
    And the authenticated operator can still view and control the desktop
    And resume requires a new desktop epoch

  Scenario: Deliver input to a polled virtual USB device
    Given a guest that samples virtual keyboard and pointer state
    When a key or mouse button is pressed
    Then the press remains visible across a device poll
    And cancellation still releases the pressed input
