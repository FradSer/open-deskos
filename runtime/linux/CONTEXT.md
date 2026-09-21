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

**Widget / App (unified)**:
The single plugin model going forward. A Widget shares desktop grid pages with other tiles; an App owns an individual page. Any Widget or App may additionally provide a Service Plugin for its data needs. There is no separate User Application concept: previously installed user packages are read as Widgets/Apps under this unified model.
_Avoid_: user application, built-in versus user plugin tiers, generated file equals installed app, arbitrary Shell plugin injection

**Retired: User Application**:
The former term for locally authored Widgets/Apps is retired and must not appear in new features, manifests, or docs. The unified Widget/App terms above replace it. The entries below (Application Candidate, Installed Revision) are retained only as lifecycle vocabulary until renamed under the unified model.
A locally authored, versioned Widget or interactive App installed and managed by Open DeskOS. It is distinct from trusted built-in Shell plugins and from its editable draft.
Widgets share desktop grid pages with built-in tiles; their persisted placement is independent of the installed revision. Interactive Apps own individual pages. There is no dedicated User Applications collection page.
_Avoid_: generated file equals installed app, arbitrary Shell plugin injection, user-created means confined to a final page

**Voice Agent**:
The resident CM5 component that turns a recognized Spoken Turn into work: transcription, the agent run, and the spoken response. It is a system component of the desk runtime, not an optional plugin, so a desk without it is not a complete desk rather than a lesser one. It differs from the P4 Camera Peripheral, which supplies the microphone it captures from, and from Hosted Pi sessions, which it can start.
_Avoid_: optional add-on, experimental service, voice feature toggle

**Application Candidate**:
An exact snapshot of a draft awaiting system-owned verification. Failed verification cannot replace the installed revision.
_Avoid_: agent self-certified installation, mutable installed workspace

**Installed Revision**:
The application version selected by the system catalog for presentation, independently of the Shell runtime release. Closing its interface does not uninstall it; uninstalling does not delete its draft.
_Avoid_: running process, active Shell release, draft version

## Service Plugins

**Service Plugin**:
A CM5-resident service provided by a plugin: it runs as an independent process with its own lifecycle and supplies data to the Display Shell. It is distinct from a User Application, which is an opaque HTML package with no background-service or network capability, and from built-in Shell data sources, which ship inside the Shell release.
_Avoid_: user application with network access, built-in shell source, background process without a declared contract

**Service Credential**:
A named secret a Service Plugin declares, the shell collects through system-owned UI, the user authorizes once, and the vault injects into the service process by name at runtime. The value never enters the package, the release, or plugin-drawn interface.
_Avoid_: secret in the package, plugin-drawn password field, operator-only provisioning file

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

**Retired: Managed Coding Task**:
The former term for a Pi coding request owned by a configured CM5 or Mac host is retired and must not appear in new features, manifests, or docs. **Hosted Pi** replaces it; that entry keeps the durable identity, host ownership, and non-cancellation-by-disconnect properties this term carried.
_Avoid_: monitored terminal session, accepted means completed, finished means tests passed

**Coding Target**:
An operator-configured machine and development-root scope available to the Voice Agent. An ambiguous target requires clarification; a configured target is not proof of current connectivity or a filesystem sandbox.
_Avoid_: arbitrary SSH host, unrestricted machine access, configured means online

**Voice Capability**:
An installed action available to the Voice Agent, such as building a Widget/App or sending a prompt to a specific live Pi session. Additional applications can expose capabilities without owning recording or transcription.
_Avoid_: keyword-only command routing, arbitrary renderer code execution

**Controllable Pi Session**:
A live Pi session that explicitly exposes a prompt-delivery endpoint. Being visible in the Pi Sessions monitor does not by itself make a session controllable. Accepted or queued delivery is not proof that its task has completed. A Hosted Pi is one such session; a Reported Session is not.
_Avoid_: editing session history to inject a prompt, terminal keystroke simulation, treating observed processes as control endpoints

## Pi Sessions Inspection

**Desk Link**:
A package-initiated, token-authenticated connection from one Pi machine to one Open DeskOS runtime. It is the only channel through which that machine's Reported Sessions are known, and it never requires Open DeskOS to reach the machine. Control does not travel on this connection: a machine opens a separate control connection to the same listener, gated by a Control Credential.
_Avoid_: SSH source, collector, polling scan, Remote Bridge

**Reporting Machine**:
A machine with at least one live Desk Link. It is identified by its Desk Link, never by a network address or an SSH alias.
_Avoid_: remote host, SSH alias, monitored source, client

**Reported Session**:
A Pi session that Open DeskOS knows only through a Desk Link. It is inspected exactly like a scanned session, and visibility through a Desk Link never implies that it can be managed.
_Avoid_: remote session, SSH session, imported session, controllable session

**Desk Link Service**:
The Open DeskOS runtime service that accepts Desk Links. It listens on the local network only and authenticates every Desk Link with a per-link token; its channel to the runtime is a Unix socket authenticated by filesystem ownership instead.
_Avoid_: bridge, gateway, ingest API, HTTP server

**Live Session**:
A Pi session whose process is still running, whether it is working or idle at its prompt. It is the only kind the Pi Sessions page shows; an exited session is history and never appears there.
_Avoid_: running session, all sessions, reported session, active task

**Working Session**:
A live session that is streaming a turn. The page states it as `Working...` beside Pi's own braille indicator, and its Session Detail follows the newest event.
_Avoid_: running session, busy agent, active task

**Idle Session**:
A live session that is not streaming and is waiting for input. The page states it as `Idle` with no indicator. Its reported status name is `settled`, which is a wire value and not product language.
_Avoid_: settled session, stopped session, dead session

**Exited Session**:
A Pi session whose process has ended. It is not listed on the Pi Sessions page; its reported status survives only for the scanner, the status bar, and diagnosis.
_Avoid_: finished task, historical session, completed session

**Session Set**:
The subset of Pi sessions the Session Filter currently selects. It is the shared candidate set for the Session Switcher and the Session Overview. The Pi status-bar count is a separate, always-running reading and never follows the filter.
_Avoid_: filtered list, all sessions, active agents

**Session Filter**:
The Session Overview's own narrowing of the Session Set: Live, Working, Idle, Exited, or All. It defaults to Live, which is running plus settled, so the page lands on started sessions and history waits behind the Exited tab. Its tabs live in the Session Overview only — the Session Detail carries none — and the Remote Control Strip carries one filter button whose label is the current filter and which advances to the next on press. It is transient and does not survive a shell restart.
_Avoid_: page-wide status toggle, search, workspace grouping, remote view mode, tab bar on the Session Detail

**Session Switcher**:
The Pi Sessions page's movement between the members of the Session Set with Remote horizontal input. It stops at the first and last member instead of wrapping, and it remembers its selection by session identity rather than position.
_Avoid_: carousel, tab switcher, session pager, agent switcher

**Session Title**:
The Pi Sessions page's title while a session is shown: the session's own Pi state and the directory it works in, with the elapsed label at the right of that row. There is no page title above it and no control beside it.
_Avoid_: page heading, workspace name, banner

**Session Detail**:
The Pi Sessions page's single-session view: the session's own Pi state as the title, its directory, how long it has been running, and its bounded stream of recent Session Events.
_Avoid_: log viewer, transcript, agent panel, terminal

**Session Event**:
One bounded entry in a Session Detail stream, derived from the session's own message log or Desk Link. Every kind keeps the body Pi produced, with its own byte limit and an explicit truncation flag: a tool result 64 KiB, an assistant reply 16 KiB, a prompt 8 KiB, and a thought or tool call 4 KiB. Nothing is flattened to a single line, so a bash command, a prompt, and a result read as Pi wrote them. The recent stream retains at most 300 entries and 1 MiB of text per session.
_Avoid_: complete transcript, unbounded log, first-line-only summary

**Pi Reading Palette**:
The colour roles Pi's own theme uses for Markdown, syntax, and diffs, reproduced inside Session Event bodies so a transcript reads on the desk the way it reads in Pi. It is scoped to quoted Pi content and never governs the page's own surfaces, which stay on the DESIGN.md semantic tokens.
_Avoid_: brand palette, theme override, accent decoration

**Session Overview**:
The Pi Sessions page's home view: the Session Filter's tabs above a single-column list of the Session Set, reachable with Remote Back from a Session Detail. It follows Pi's native session-list hierarchy with a state, goal, directory, and activity per row, and a selection cursor, while inheriting the Shell theme. Choosing a row shows that session's Session Detail.
_Avoid_: honeycomb, exposé, agent grid, tab overview, dashboard

## Hosted Pi Control

**Hosted Pi**:
A Pi coding session hosted by the Open DeskOS runtime and optionally driven from another machine through a Console. It has a durable identity, keeps running when its Console disconnects, and publishes its events under a position taken from its own session log. Its lifecycle is separate from the outcome of any one turn: cancelling or failing a turn may leave the Hosted Pi alive and idle, while End disposes it.
_Avoid_: managed coding task, remote session, terminal window, monitored session, Reported Session, turn outcome used as session lifecycle

**Hosted Pi Lifecycle**:
Whether the Hosted Pi identity and SDK session remain available: launching, live, ended, or interrupted. While live, its activity is working or idle. End changes lifecycle; Cancel changes the current turn and normally returns the same Hosted Pi to live-idle.
_Avoid_: finished turn means ended session, cancelled session when only a turn was cancelled, unknown means working

**Hosted Pi Turn Outcome**:
The result of one Hosted Pi turn: finished, failed, cancelled, or interrupted. It is recorded separately from Hosted Pi Lifecycle and never by itself releases the Hosted Pi's slot or identity.
_Avoid_: session state, verification result, lifecycle, ended Hosted Pi

**Console**:
A Pi session on another machine that has attached to one Hosted Pi and directs its turns. One Console drives one Hosted Pi at a time.
_Avoid_: remote, controller, Remote Control, Remote Bridge, client

**Control Link**:
The control connection a Console opens: the authenticated path over which it lists, launches, attaches to, prompts, cancels, ends, and reads the history of Hosted Pi sessions. It is its own connection to the same listener, not a second listener and not the reporting connection, and it is short-lived for single requests or held while a Console is attached.
_Avoid_: Remote Link, SSH source, second port, admin API, management API, shared link

**Control Credential**:
The secret that authorizes control, held separately from the reporting token and never transmitted: the desk challenges with a one-time nonce and a Console answers with a proof over it. A connection that cannot prove it stays report-only, and a machine without it never becomes a Console.
_Avoid_: link token, reporting token, Service Credential, admin password

**Attach**:
A Console binding to one Hosted Pi to receive its events and direct its turns. Attaching replaces rather than shares any previous Console, is idempotent, and is repeatable by Hosted Pi identity. Attaching again continues from the position the Console last applied, so nothing is repeated and nothing is skipped.
_Avoid_: takeover, subscribe, connect, share a session, exclusive lease, resume window

**Hosted Pi Position**:
The place of a complete entry in a Hosted Pi's own session log, used as the single coordinate for both its live events and its history. One complete entry may map to a batch of several Session Events, and the batch is applied atomically before its position is advanced. Position zero is before the first entry. It is durable because the log is, so no separate counter or replay window exists. History reads start strictly after a supplied position; an Attach catches up through a captured inclusive boundary and then follows live entries after it.
_Avoid_: sequence number, cursor, byte offset, event id, one position per rendered sub-event, separate monotonic counter

**Control Attribution**:
The desk-visible statement of which Console currently drives a Hosted Pi. It stays visible for as long as that control exists and disappears when the Console disconnects; it never takes local touch or keyboard authority away.
_Avoid_: hidden remote, silent control, local lockout, invisible driver

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

**Mali Userspace**:
The ARM libmali blob plus CSF firmware installed by `scripts/cm5-gpu-userspace.sh`, which lets the kernel's existing Rockchip kbase driver run the Mali-G610 through the vendor X11/GBM EGL platform. Its presence selects the Mali Chromium backend: ANGLE pinned to gles-egl with software display compositing, because the blob loses its GPU context when Chromium swaps an X11 window surface.
_Avoid_: expecting Mesa to drive this GPU on this kernel, claiming GPU display compositing, treating llvmpipe as the accelerated path
