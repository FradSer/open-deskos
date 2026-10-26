Feature: Apple TV style Remote Touchpad with contextual Touch Bar
  As a person holding a Waveshare ESP32-S3 Touch LCD 2.8
  I want an Apple TV style remote with a touch pad, dedicated back and voice buttons, and a contextual touch bar
  So that I can fluidly navigate in four directions, access system controls, and use dynamic plugin actions

  Background:
    Given the device runs on the Waveshare ESP32-S3 Touch LCD 2.8
    And the device has one encrypted NanoC6 ESP-NOW peer

  Scenario: USB supports power and firmware maintenance only
    When the firmware starts
    Then the host can enumerate the ESP32-S3 USB JTAG serial device
    But USB records cannot update Remote state or relay physical input
    And the Remote uses only its encrypted ESP-NOW peer for control

  Scenario: Touchpad directional navigation is always available via swipe
    Given the ESP-NOW session has synchronized authoritative state
    And the CST328 touch interrupt can recover a malformed frame by returning the controller to normal mode
    When I swipe up, down, left, or right across at least 40 pixels on the touchpad
    Then the host receives one versioned input record with the matching direction
    And full-frame polling never clears a touch frame through a separate status read
    And repeated touch reports for that gesture do not send another input record
    And six stable touch-release polls are required before the next gesture

  Scenario: Touchpad directional navigation is always available via cardinal ring taps
    Given the ESP-NOW session has synchronized authoritative state
    When I tap the top outer ring of the touchpad
    Then the host receives one versioned up input record
    When I tap the bottom outer ring of the touchpad
    Then the host receives one versioned down input record
    When I tap the left outer ring of the touchpad
    Then the host receives one versioned left input record
    When I tap the right outer ring of the touchpad
    Then the host receives one versioned right input record

  Scenario: Touchpad center tap emits primary and hold emits secondary
    Given the ESP-NOW session has synchronized authoritative state
    When I tap the center of the touchpad
    Then the host receives one versioned primary input record
    When I hold the center of the touchpad for at least 600 milliseconds
    Then the host receives one versioned secondary input record
    And releasing that long press does not emit primary input

  Scenario: Dedicated system buttons for Back and Voice are below the touchpad
    Given the ESP-NOW session has synchronized authoritative state
    When I tap the Back button below the touchpad
    Then the host receives one versioned back input record
    When I tap the Voice button below the touchpad
    Then the host receives one versioned mic input record
    And the CM5 starts the resident Pi Personal Agent recording through the configured P4 microphone

  Scenario: Remote input remains available after release cleanup
    Given the Remote Bridge was installed from an isolated staging snapshot
    When that staging directory is removed after release activation
    Then the Remote Bridge starts from the active immutable release
    And touch and MIC input continue to reach the CM5

  Scenario: Dynamic Touch Bar at the bottom renders plugin-customizable action buttons
    Given the ESP-NOW session has synchronized authoritative state
    When the radio receives a state frame with dynamic actions
    Then the Touch Bar at the bottom of the screen displays the action labels
    When I tap a dynamic action button on the Touch Bar
    Then the host receives one versioned action input record with the matching action identifier

  Scenario: Empty Touch Bar does not emit actions
    Given the ESP-NOW session has synchronized authoritative state
    When the radio receives a state frame with no actions
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
    Given no complete authoritative state JSON frame has arrived through ESP-NOW
    Then no host connection is claimed
    And the touchpad and system buttons remain directly interactive

  Scenario: Touchpad gestures are consumed before state synchronization
    Given no valid state frame has arrived through ESP-NOW
    When I swipe right across at least 40 pixels
    Then no input record reaches the host
    And reconnecting cannot replay that gesture
    And a contact that started offline must release before a new input is accepted

  Scenario: Cached state never suppresses a Touchpad input record
    Given the ESP-NOW session has synchronized authoritative state
    And the screen has received a valid state frame for the last page
    When I swipe right across at least 40 pixels
    Then the host receives one versioned right input record
    And the host remains the authority that keeps navigation at its last page

  Scenario: An authoritative v1 state frame updates the contextual Touch Bar
    When the radio receives the frame "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wireless\",\"actions\":[{\"id\":\"refresh\",\"label\":\"SYNC\"}]}\n"
    Then the Touch Bar displays "SYNC"
    And the screen contains only ASCII text
    And the full touchpad remains available

  Scenario: Invalid or oversized radio records do not replace or redraw the displayed state
    Given the screen currently shows a state received from a valid v1 frame
    When the radio receives an unversioned state line
    Or the radio receives a state line whose page boundaries contradict canPrev or canNext
    Or the radio receives a state line whose link is neither "wired" nor "wireless"
    Or the radio receives an invalid actions payload
    Or the radio receives a valid state object followed by non-JSON data on the same line
    Then the screen retains the last valid state
    And the screen is not redrawn for the invalid frame

  Scenario: Action metadata exceeding the display buffers is rejected
    Given the screen currently shows a state received from a valid v1 frame
    When the radio receives an action whose identifier or label exceeds the display buffer
    Then the screen retains the last valid state
    And the oversized action is not sent back to the host

  Scenario: Repeated valid state frames do not redraw the screen
    Given the screen currently shows a state received from a valid v1 frame
    When the radio receives the identical valid v1 frame again
    Then the screen retains the last valid state
    And the framebuffer is not transferred again

  Scenario: Plugin descriptor generation preserves manifest values in valid C
    Given a manifest identifier contains punctuation, spaces, and a leading digit
    And two other identifiers differ only by punctuation that maps to the same C identifier
    And its display name contains quotes, slashes, and control characters
    When the generated descriptor is compiled and read
    Then it compiles without warnings
    And the original identifier and display name are preserved
    And each manifest has a distinct descriptor and port table

  Scenario: Native plugins retain the Remote boot order
    Given display, touch, buffers, gesture, serial, and surface plugins
    When the Remote boots
    Then it starts their declared dependencies before the surface
    And the surface uses the same touch gestures and versioned input and state records

  Scenario: A Remote driver fails during boot
    Given a partially initialized native driver
    When its initialization fails
    Then the host destroys its owned resources
    And the boot entry stops other initialized drivers before it reports failure

  Scenario: Remote consumers use the selected buffer provider
    Given generated Remote descriptors select a buffer provider
    When the actual Serial and Surface consumers initialize
    Then both consumers use that provider's framebuffer and state queue
    And Surface renders through the selected display port
    When display draining fails during shutdown
    Then the host retains the Surface dependencies until cleanup succeeds
    And successful cleanup clears the consumer references

  Scenario: The radio-only Remote cannot use USB control
    Given the S3 contains the ESP-NOW Remote firmware and private pairing data
    When a host writes Remote state records to its USB port
    Then those records cannot update the Remote state
    And physical gestures use only the encrypted paired ESP-NOW peer
    And an offline gesture is consumed without later replay
    And missing pairing data leaves the surface idle

  Scenario: Incomplete or stale radio state cannot activate controls
    Given the S3 has a current gateway session
    When state fragments are incomplete, oversized, duplicated inconsistently, or from another session
    Then the last authoritative state is unchanged
    And only a complete valid state receives an application acknowledgement
    When the current gateway stops sending heartbeats
    Then the contextual actions clear and gestures cannot send input

  Scenario: Decoded NUL strings cannot hide state fields or action metadata
    Given the Remote displays a complete valid state
    When a state contains a decoded NUL escape in a value or member name
    Then the state parser rejects it without changing the displayed state
    And a later valid state still parses
    And a literal escaped backslash followed by u0000 remains valid text
