# Linux Remote Control

This context covers the Open DeskOS Linux display, its USB-connected ESP32-S3 touch remote, and the local P4 owner-lock boundary.

## Language

## Owner Lock

**Physical Owner Enrollment**:
The one-shot act of recording the configured owner from exactly one valid P4 camera observation after a physical confirmation. It is the only way to create a P4 owner identity.
_Avoid_: remote enrollment, HTTP enrollment, serial enrollment

**Owner-Locked Screen**:
The Display Shell condition in which protected information remains covered until the current P4 observation recognizes the enrolled owner.
_Avoid_: guest mode, optimistic unlock, camera-ready screen

**Owner Recognition**:
A current P4 camera observation that identifies the enrolled owner strongly enough to release the Owner-Locked Screen.
_Avoid_: face detected, assumed identity, host recognition

**Owner Recognition Verification**:
The accepted hardware evidence sequence: show the Owner-Locked Screen before enrollment, physically enroll one owner, then observe a fresh P4 owner-recognition result and an unlocked Display Shell.
_Avoid_: enrollment-only validation, face-detection-only validation

**Diagnostic Snapshot**:
A temporarily enabled, CM5-local still image used only to align the P4 camera during hardware verification. It is disabled by default and is not a Display Shell data source or an unlock input.
_Avoid_: camera preview, production video feed, recognition fallback

**Camera-Usable Scene**:
A P4 camera observation with sufficient visible detail for on-device face detection. A valid camera link that produces an effectively black frame is not a Camera-Usable Scene.
_Avoid_: camera online, capture working, dark-frame ready

**Remote Control**:
The ESP32-S3 touchscreen device that turns direct touch interaction into navigation input for the Linux display.
_Avoid_: keyboard, controller

**Display Shell**:
The Open DeskOS Linux shell running at the CM5's native 1920×1280 HDMI content size and controlled by Remote Control navigation input. The shell keeps responsive geometry checks for alternate development window sizes.
_Avoid_: separate demo, remote, firmware

**HID Navigation**:
Remote Control navigation conveyed to the focused Display Shell as standard USB HID `ArrowLeft` and `ArrowRight` key presses. It remains available whenever USB is enumerated, including while CDC state feedback is synchronizing.
_Avoid_: serial command, custom USB protocol, global keyboard interception

**Navigation Surface**:
The Remote Control's paired large previous/next touch targets, which also recognize a horizontal swipe across the screen as the same navigation intent.
_Avoid_: gesture-only navigation, button-only navigation

**Remote Firmware**:
A standalone ESP-IDF project under `firmware/linux/remote-control/` that replaces the former keyboard and exposes only the Remote Control experience plus HID Navigation. It is delivered with the Linux Display Shell rather than as part of the P4 Open DeskOS firmware application.
_Avoid_: keyboard firmware, multi-app shell, PlatformIO firmware, P4 firmware component

**Bounded Paging**:
Display Shell navigation that stops at the first and last page; navigation input at either boundary leaves the current page unchanged.
_Avoid_: wraparound paging, circular paging

**Remote State Feedback**:
The Display Shell's authoritative current-page and boundary state presented back on the Remote Control after navigation. Before the first state arrives, Remote Control shows an explicit connecting or disconnected state instead of a guessed page. The Display Shell peek reports only factual Remote Link states: disconnected, USB connected, or synchronizing.
_Avoid_: send-only feedback, assumed page state, stale page display, fabricated telemetry

**Remote Bridge**:
A Node.js systemd user service that owns the active Remote Link and relays Display Shell state to the Remote Control independently of whether the link is wired USB or wireless ESP-NOW. It communicates with the Electron main process over a permission-restricted Unix domain socket and starts with the CM5 graphical user's session.
_Avoid_: Electron serial access, HID state tracker, local HTTP bridge, separate Python runtime, kiosk child process

**Remote Link**:
The bidirectional transport between the Remote Control and Remote Bridge: USB HID plus CDC while wired, and ESP-NOW through a future ESP32-C6 gateway while wireless. The wired adapter identifies its CDC device through Remote Firmware's unique `/dev/serial/by-id/` link, never a numbered `ttyACM` path. Its absence never blocks direct Display Shell interaction; reconnection triggers an authoritative state sync.
_Avoid_: USB-only protocol, ESP-NOW-only protocol, required-display dependency, numbered ttyACM path

**C6 Gateway**:
The future ESP32-C6 installed with the CM5 that bridges ESP-NOW Remote Link traffic to the Remote Bridge over a 3.3V UART Host Link.
_Avoid_: Display Shell, Remote Control

**Host Link**:
The 3.3V UART connection between C6 Gateway and CM5 that carries framed Remote Messages.
_Avoid_: USB gateway link, direct ESP-NOW connection

**Remote Pair**:
The preconfigured single ESP32-S3 and C6 Gateway peer relationship secured with ESP-NOW peer keys; only that Remote Control may navigate the Display Shell.
_Avoid_: open broadcast, multi-remote pairing flow

**Wired Vertical Slice**:
The first deliverable: Remote Firmware sends HID Navigation over USB, Display Shell publishes authoritative state through Remote Bridge, and the bridge returns it over USB CDC; the wireless adapter boundary is delivered but C6 hardware is not yet deployed.
_Avoid_: USB-only architecture, full wireless delivery

**Remote Message**:
A versioned JSON Lines command or state record shared across wired and wireless Remote Link adapters. In wired operation, HID alone requests navigation and CDC carries authoritative state; in wireless operation, `navigate` records request Display Shell navigation through Remote Bridge rather than keyboard emulation.
_Avoid_: transport-specific payload, unversioned serial text
