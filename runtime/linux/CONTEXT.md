# Open DeskOS CM5 Architecture Context

## Product Boundary

**Active Open DeskOS**:
The CM5/Linux runtime is the current Open DeskOS subject. The CM5 owns the desk display, local services, application orchestration, and direct operation. Apple platforms are not part of this active architecture.
_Avoid_: calling Linux a migration slice, making a Mac companion mandatory, or allowing the prior P4+C6 DeskOS route to define active product requirements.

**Required Peripheral Architecture**:
The ESP32-S3 Remote Control and the ESP32-P4 SC2336 Camera Sub-device are intended parts of the CM5 system architecture, but each has an independent hardware acceptance gate. Their absence must not prevent a base CM5 shell from installing, booting, or offering direct touch and keyboard operation.
_Avoid_: treating every MCU as merely optional, or making an unaccepted peripheral a boot/install dependency.

**Prior P4+C6 DeskOS Research**:
The prior ESP32-P4+C6 device OS is a preserved parallel exploration: P4 as UI/HID/voice host, C6 as Wi-Fi/ESP-NOW coprocessor, LVGL/Lua/AIODI shell, and Apple USB companion. It is distinct from the current P4 camera sub-device and cannot define the CM5 product, release gates, or interaction model.
_Avoid_: confusing it with the P4 camera sub-device, calling it the active production authority, or deleting its experimental assets.

**Apple P4 Companion**:
`research/esp32-p4-c6-deskos/apple/` belongs to the prior P4+C6 research line. Its USB serial subscription bridge, time synchronization, and P4-specific management contracts are not dependencies of the active CM5 architecture.
_Avoid_: adapting P4 serial commands as CM5 product interfaces.

## Language

**User Application**:
A locally authored, versioned Widget or interactive App installed and managed by Open DeskOS. It is distinct from trusted built-in Shell plugins and from its editable draft.
Widgets share desktop grid pages with built-in tiles; their persisted placement is independent of the installed revision. Interactive Apps own individual pages. There is no dedicated User Applications collection page.
_Avoid_: generated file equals installed app, arbitrary Shell plugin injection, user-created means confined to a final page

**Application Candidate**:
An exact snapshot of a draft awaiting system-owned verification. Failed verification cannot replace the installed revision.
_Avoid_: agent self-certified installation, mutable installed workspace

**Installed Revision**:
The application version selected by the system catalog for presentation, independently of the Shell runtime release. Closing its interface does not uninstall it; uninstalling does not delete its draft.
_Avoid_: running process, active Shell release, draft version

**Open DeskOS Workspace**:
The shared writable project workspace used by Open DeskOS development and automation capabilities. Voice is one entry point into it, not its owner. It is distinct from the active runtime release and each agent's conversation history.
_Avoid_: voice workspace, active release directory, Pi session storage

**Voice Agent**:
The CM5-resident Pi agent that interprets a Remote-triggered spoken request and invokes explicitly installed capabilities. It is independent of the Pi Sessions monitoring surface and remains available across individual voice interactions.
_Avoid_: Pi Sessions widget, microphone on the Remote, a new monitored session per button click

**Spoken Turn**:
A Remote-triggered voice recording submitted by MIC or by local detection of silence after speech. Waiting without speech is not a completed turn.
_Avoid_: fixed-duration clip, wake-word session, silence means a request

**Hidden Voice Interaction**:
An activated voice interaction whose feedback has been dismissed without cancelling its work. MIC restores that interaction before taking any recording action, even if it completed while hidden.
_Avoid_: cancelled task, new recording, discarded conversation

**Voice Transcript**:
The recognized user speech sent to the resident Voice Agent for the current Spoken Turn. It remains distinct from the agent's response and is shown before execution output.
_Avoid_: agent interpretation, generated reply, editable prompt history

**Streaming Reply**:
The current request's public assistant text shown while execution is still in progress. It is not a completed result until the request finishes, and excludes internal thinking and raw tool records.
_Avoid_: simulated typing, tool logs, completion proof

**Input Level**:
The measured strength of microphone audio during a Spoken Turn. It describes input activity, not whether the audio is speech or how much of a request is complete.
_Avoid_: speech probability, processing progress, decorative waveform

**Managed Coding Task**:
An explicitly targeted Pi coding request owned by a configured CM5 or Mac host independently of voice feedback and control-connection lifetime. Its durable identity distinguishes acceptance, execution, termination, and verification. Closing voice feedback does not cancel it.
_Avoid_: monitored terminal session, accepted means completed, finished means tests passed

**Coding Target**:
An operator-configured machine and development-root scope available to the Voice Agent. An ambiguous target requires clarification; a configured target is not proof of current connectivity or a filesystem sandbox.
_Avoid_: arbitrary SSH host, unrestricted machine access, configured means online

**Voice Capability**:
An installed action available to the Voice Agent, such as building a Widget/App or sending a prompt to a specific live Pi session. Additional applications can expose capabilities without owning recording or transcription.
_Avoid_: keyword-only command routing, arbitrary renderer code execution

**Controllable Pi Session**:
A live Pi session that explicitly exposes a prompt-delivery endpoint. Being visible in the Pi Sessions monitor does not by itself make a session controllable. Accepted or queued delivery is not proof that its task has completed.
_Avoid_: editing session history to inject a prompt, terminal keystroke simulation, treating observed processes as control endpoints

## Pi Sessions Inspection

**Running Session**:
A live Pi session whose process is alive. It is the unit the Session Switcher rotates through.
_Avoid_: agent, running agent, active task, controllable session

**Session Set**:
The subset of Pi sessions currently selected by the Session Filter. It is the shared candidate set for the Session Switcher and the Session Overview. The Pi status-bar count is a separate, always-running reading and never follows the filter.
_Avoid_: filtered list, active agents, candidate list

**Session Filter**:
The Pi Sessions page's selection of which sessions the Session Set contains: All, Working, Settled, or Exited. It defaults to Working and does not survive a shell restart.
_Avoid_: search, workspace grouping, status toggle, remote view mode

**Session Switcher**:
The Pi Sessions page's horizontal movement between the members of the Session Set during App Focus Mode. It stops at the first and last member instead of wrapping, and it remembers its selection by session identity rather than position.
_Avoid_: carousel, tab switcher, session pager, agent switcher

**Session Detail**:
The Pi Sessions page's single-session view: the selected session's identity plus its bounded stream of recent Session Events.
_Avoid_: log viewer, transcript, agent panel, terminal

**Session Event**:
One bounded single-line entry in a Session Detail stream, derived from the session's own message log. It reports that the session did something, never the body of a tool result.
_Avoid_: transcript line, log record, tool output

**Session Overview**:
The Pi Sessions page's grid of the current Session Set, opened from the Remote Control Strip. Choosing a cell returns to that session's Session Detail.
_Avoid_: honeycomb, exposé, agent grid, tab overview, dashboard

## P4 Camera Peripheral

**Generic UVC Webcam**:
The ESP32-P4 SC2336 peripheral exposes a standard USB Video Class MJPEG stream and a standard USB Audio Class microphone. It performs no face detection, owner recognition, expression classification, or biometric storage.
_Avoid_: face detected, assumed identity, host recognition, emotion labels

**Camera Acceptance**:
The CM5 hardware acceptance sequence for the camera peripheral: verify the composite USB identity, resolve the V4L2 video device, and capture one bounded MJPEG frame without storing media.
_Avoid_: treating it as base-shell acceptance

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

**Remote Touchpad**:
The Remote Control input surface that emits directional movement, a primary press, and a secondary press to the focused Display Shell.
_Avoid_: keyboard, controller, navigation buttons

**Secondary Action**:
A Remote Touchpad long-press request offered to the currently focused App control. A control that does not explicitly support it leaves the App unchanged.
_Avoid_: back, cancel, universal context menu

**App Initial Focus**:
The first Remote Touchpad focus target for an App. An App may declare it; otherwise the first visible enabled interactive control is the target.
_Avoid_: arbitrary focus, page-level focus

**App Focus Mode**:
The input mode while a focused App page is active: directional input belongs to that App and never requests page navigation. An App may declare one axis as its primary movement — switching between the items it is showing — while the other axis moves within the current item. Bounded Paging resumes when the App is no longer active.
_Avoid_: edge-to-page navigation, mixed page and App focus, App input that pages the shell

**Remote Firmware**:
A standalone ESP-IDF project under `peripherals/esp32-s3-remote/` that exposes only the Remote Control experience plus HID Navigation. It is a required architecture peripheral with its own hardware acceptance gate; direct shell input remains available before that gate passes.
_Avoid_: keyboard firmware, multi-app shell, PlatformIO firmware, P4 firmware component

**Bounded Paging**:
Display Shell navigation that stops at the first and last page; navigation input at either boundary leaves the current page unchanged. On a non-interactive page, only left and right request bounded paging; up, down, primary, and secondary leave the page unchanged.
_Avoid_: wraparound paging, circular paging

**Remote State Feedback**:
The Display Shell's authoritative current-page, interaction mode, and available control-strip actions presented back on the Remote Control after navigation. Before the first state arrives, Remote Control shows an explicit connecting or disconnected state instead of a guessed page. Remote Link state remains available to the Remote Control and its dedicated runtime surface; the Display Shell State Bar stays limited to its network indicator.
_Avoid_: send-only feedback, assumed page state, stale page display, fabricated telemetry

**Remote Control Strip**:
The Remote Control's plugin-owned contextual action bar. Browse mode offers Previous and Next; App Focus Mode offers directional movement and Select; Back is persistent in every mode. A page that owns strip buttons publishes them as its own authoritative state instead of declaring them in the desktop layout.
_Avoid_: universal touchpad, fixed controller layout, remote shell, fixed strip contents

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
