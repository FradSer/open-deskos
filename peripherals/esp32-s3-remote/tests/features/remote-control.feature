Feature: USB remote control for the Open DeskOS Linux shell
  As a person holding a Waveshare ESP32-S3 Touch LCD 2.8
  I want a touch remote that behaves as a USB keyboard and exposes a CDC state link
  So that I can navigate the Linux shell while seeing its honest current state

  Background:
    Given the device runs on the Waveshare ESP32-S3 Touch LCD 2.8
    And the device is attached to a host through its native USB-OTG port

  Scenario: USB enumerates as keyboard and CDC
    When the firmware starts
    Then the host sees one composite USB HID keyboard and CDC ACM device

  Scenario: Large on-screen targets send one debounced keyboard navigation event
    Given the HID keyboard is ready
    When I tap the large left target
    Then the host receives one HID ArrowLeft key
    And repeated touch reports for that tap do not send another navigation key
    And six stable touch-release polls are required before the next navigation gesture
    When I tap the large right target after the release is confirmed
    Then the host receives one HID ArrowRight key

  Scenario: Consecutive next taps are not lost after their releases are confirmed
    Given the HID keyboard is ready
    When I tap the large right target
    And six stable touch-release polls confirm that tap has ended
    And I tap the large right target again
    Then the host receives two HID ArrowRight keys

  Scenario: A horizontal swipe sends one directional navigation key
    Given the HID keyboard is ready
    When I swipe horizontally from right to left across at least 48 pixels
    Then the host receives one HID ArrowRight key
    When I swipe horizontally from left to right across at least 48 pixels
    Then the host receives one HID ArrowLeft key

  Scenario: The screen is honest before a valid state frame arrives
    Given no newline-delimited state JSON frame has arrived on CDC
    Then the screen says "Connecting to Open DeskOS"
    And it does not claim that a host is connected

  Scenario: HID navigation remains available before state synchronization
    Given no valid state frame has arrived on CDC
    And the HID keyboard is ready
    When I tap the large left target
    Then the host receives the HID ArrowLeft key
    When I tap the large right target
    Then the host receives the HID ArrowRight key

  Scenario: Cached state never suppresses a navigation key
    Given the HID keyboard is ready
    And the screen has received a valid state frame for the last page
    When I tap the unavailable right target
    Then the host receives the HID ArrowRight key
    And the host remains the authority that keeps navigation at its last page

  Scenario: An authoritative v1 state frame updates the English-only screen
    Given the screen says "Connecting to Open DeskOS"
    When CDC receives the frame "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wired\"}\n"
    Then the screen shows "Home"
    And the screen shows "1/3"
    And the screen contains only ASCII text
    And the previous target is shown unavailable
    And the next target is shown available
    And it no longer says "Connecting to Open DeskOS"

  Scenario: Invalid or oversized CDC lines do not replace or redraw the displayed state
    Given the screen currently shows a state received from a valid v1 frame
    When CDC receives an unversioned state line
    Or CDC receives a state line whose page boundaries contradict canPrev or canNext
    Or CDC receives a state line whose link is neither "wired" nor "wireless"
    Or CDC receives a line longer than 255 bytes
    Then the screen retains the last valid state
    And the screen is not redrawn for the invalid frame

  Scenario: Repeated valid state frames do not redraw the screen
    Given the screen currently shows a state received from a valid v1 frame
    When CDC receives the identical valid v1 frame again
    Then the screen retains the last valid state
    And the framebuffer is not transferred again

  Scenario: A wireless C6 link uses the fixed English page label
    Given the screen says "Connecting to Open DeskOS"
    When CDC receives the frame "{\"v\":1,\"type\":\"state\",\"page\":3,\"pages\":3,\"name\":\"Billing\",\"canPrev\":true,\"canNext\":false,\"link\":\"wireless\"}\n"
    Then the screen shows "USAGE"
    And the screen shows "3/3"
    And the screen contains only ASCII text
    And the previous target is shown available
    And the next target is shown unavailable
