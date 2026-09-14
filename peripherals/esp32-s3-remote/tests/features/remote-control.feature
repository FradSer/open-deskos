Feature: Apple TV style Remote Touchpad with contextual Touch Bar
  As a person holding a Waveshare ESP32-S3 Touch LCD 2.8
  I want an Apple TV style remote with a touch pad, dedicated back and voice buttons, and a contextual touch bar
  So that I can fluidly navigate in four directions, access system controls, and use dynamic plugin actions

  Background:
    Given the device runs on the Waveshare ESP32-S3 Touch LCD 2.8
    And the device is attached to a host through its USB-Serial/JTAG port

  Scenario: USB Serial/JTAG carries the Remote protocol
    When the firmware starts
    Then the host sees the ESP32-S3 USB JTAG serial device
    And that serial device carries newline-delimited Remote state and input records

  Scenario: Touchpad directional navigation is always available via swipe
    Given the CDC link is ready
    When I swipe up, down, left, or right across at least 40 pixels on the touchpad
    Then the host receives one versioned input record with the matching direction
    And repeated touch reports for that gesture do not send another input record
    And six stable touch-release polls are required before the next gesture

  Scenario: Touchpad directional navigation is always available via cardinal ring taps
    Given the CDC link is ready
    When I tap the top outer ring of the touchpad
    Then the host receives one versioned up input record
    When I tap the bottom outer ring of the touchpad
    Then the host receives one versioned down input record
    When I tap the left outer ring of the touchpad
    Then the host receives one versioned left input record
    When I tap the right outer ring of the touchpad
    Then the host receives one versioned right input record

  Scenario: Touchpad center tap emits primary and hold emits secondary
    Given the CDC link is ready
    When I tap the center of the touchpad
    Then the host receives one versioned primary input record
    When I hold the center of the touchpad for at least 600 milliseconds
    Then the host receives one versioned secondary input record
    And releasing that long press does not emit primary input

  Scenario: Dedicated system buttons for Back and Voice are below the touchpad
    Given the CDC link is ready
    When I tap the Back button below the touchpad
    Then the host receives one versioned back input record
    When I tap the Voice button below the touchpad
    Then the host receives one versioned mic input record
    And voice audio interaction remains inactive

  Scenario: Dynamic Touch Bar at the bottom renders plugin-customizable action buttons
    Given the CDC link is ready
    When CDC receives a state frame with dynamic actions
    Then the Touch Bar at the bottom of the screen displays the action labels
    When I tap a dynamic action button on the Touch Bar
    Then the host receives one versioned action input record with the matching action identifier

  Scenario: Empty Touch Bar does not emit actions
    Given the CDC link is ready
    When CDC receives a state frame with no actions
    And I tap the Touch Bar area
    Then no action input record is sent to the host
    And the Touch Bar displays the idle label "TOUCH BAR"

  Scenario: The screen has no top status bar and reserves lower space for the Touch Bar
    When the firmware starts
    Then the top status bar is omitted from the screen layout
    And the upper display area is dedicated directly to the touchpad
    And the lower display area reserves an enlarged vertical height of at least 90 pixels for the Touch Bar

  Scenario: Touchpad affordance labels render all ASCII glyphs without omission
    When the touchpad is rendered
    Then the "RIGHT" direction label contains a visible glyph for the letter "I"
    And the letter "I" is rendered with its full column patterns rather than a blank space

  Scenario: The screen is honest before a valid state frame arrives
    Given no newline-delimited state JSON frame has arrived on CDC
    Then no host connection is claimed
    And the touchpad and system buttons remain directly interactive

  Scenario: Touchpad navigation remains available before state synchronization
    Given no valid state frame has arrived on CDC
    And the CDC link is ready
    When I swipe right across at least 40 pixels
    Then the host receives one versioned right input record

  Scenario: Cached state never suppresses a Touchpad input record
    Given the CDC link is ready
    And the screen has received a valid state frame for the last page
    When I swipe right across at least 40 pixels
    Then the host receives one versioned right input record
    And the host remains the authority that keeps navigation at its last page

  Scenario: An authoritative v1 state frame updates the contextual Touch Bar
    When CDC receives the frame "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wired\",\"actions\":[{\"id\":\"refresh\",\"label\":\"SYNC\"}]}\n"
    Then the Touch Bar displays "SYNC"
    And the screen contains only ASCII text
    And the full touchpad remains available

  Scenario: Invalid or oversized CDC lines do not replace or redraw the displayed state
    Given the screen currently shows a state received from a valid v1 frame
    When CDC receives an unversioned state line
    Or CDC receives a state line whose page boundaries contradict canPrev or canNext
    Or CDC receives a state line whose link is neither "wired" nor "wireless"
    Or CDC receives an invalid actions payload
    Then the screen retains the last valid state
    And the screen is not redrawn for the invalid frame

  Scenario: Repeated valid state frames do not redraw the screen
    Given the screen currently shows a state received from a valid v1 frame
    When CDC receives the identical valid v1 frame again
    Then the screen retains the last valid state
    And the framebuffer is not transferred again
