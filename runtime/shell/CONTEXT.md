# Shell terms

Use [ARCHITECTURE](docs/ARCHITECTURE.md) for decisions and safety boundaries. Use [README](README.md) for development and operations. These definitions name current concepts; they do not replace interface contracts.

## Product Boundary

**Active Open DeskOS**: The shared Shell in `runtime/shell/`, its host services and accepted peripherals. Preserved P4+C6 research does not define active releases.

**Shell Host**: The machine and operating system running the Display Shell. CM5/Linux arm64 is reference; Windows x64 and macOS share the implementation.

**Panel**: The Shell at display bounds. It cannot be moved/resized; it is not topmost and does not hide the taskbar. See ADR-0034.

**Required Peripheral Architecture**: Intended S3 Remote and P4 camera/microphone, with separate hardware gates. Absence cannot block base Shell input or startup.

**Prior P4+C6 DeskOS Research**: Preserved LVGL/Lua/AIODI device OS and Apple USB companion, independent of the current Shell/P4 camera.

**Apple P4 Companion**: The USB subscription/time-sync client in `research/esp32-p4-c6-deskos/apple/`. Its P4 serial commands are research interfaces, not Shell dependencies.

## Language

**Widget / App (unified)**: Widgets share grid pages; Apps own pages. Either can have a declared Service Plugin. Installed HTML packages retain their verification/sandbox limits.

**Device Location**: Configured coordinates, or a bounded device lookup only when no location is supplied. Explicit empty location disables lookup. See ADR-0029.

**Weather Instrument**: A main-owned provider reading in `live`, `stale`, `unavailable` or `unconfigured` state. See ADR-0010.

**Appearance Context**: Theme, resolved tokens, fonts and radius supplied to package frames without added authority. See ADR-0011.

**Retired terminology**: Use Widget/App for User Application and Hosted Pi for Managed Coding Task. Historical wire values and filenames can remain.

**Application Candidate**: An exact draft snapshot awaiting system-owned verification. Failed verification preserves the installed revision; agents cannot self-certify installation.

**Installed Revision**: The verified package version selected by the catalog independently of the Shell release and placement. Closing does not uninstall it; removing it does not delete its draft.

**Tailscale**: Owner-managed overlay networking, reused when installed. Provisioning/login is separate from Shell startup. See ADR-0024.

**Native Module**: Optional Windows process reader. Unreadable work directories remain unknown and module failure cannot block startup.

## Service Plugins

**Service Plugin**: An independent process supplying a Widget/App. The accepted package/service design is ADR-0009; installed HTML limits remain in USER_APPLICATIONS.

**Service Credential**: A named service secret kept outside packages, releases and plugin-drawn fields. System-owned collection/vault is an accepted design, not proof of arbitrary package support.

**Service Plugin Endpoint**: Absolute socket, named pipe or TCP address selected by its declaration. See ADR-0026.

**Desk Data**: One main-owned registry of source measurements used by tiles and Personal Bot. Values are untrusted data, never rules or authorization.

**Desk Data Link**: The read-only `list`/`read` Runtime Channel. It has no mutation or second snapshot cache.

**Declared Data**: The manifest `data` fields an installed package may publish through the validated system bridge. Values cannot become instructions, rules or authorization.

**Open DeskOS Workspace**: The shared writable checkout for development and automation. Voice is one entry point; it is separate from the immutable release and conversation/session storage.

**Personal Bot**: The resident system component that transcribes, coordinates and responds on each supported Shell Host. Jev typed routing precedes workflows/readings/capabilities; low confidence asks and inference failure does not bypass routing. Hosted Pi implements source changes.

**Spoken Turn**: A voice recording submitted by MIC or silence detected after speech. Waiting without speech is not a turn; it is neither a fixed-duration clip nor a wake-word session.

**Hidden Voice Interaction**: Activated feedback hidden without cancelling work. MIC restores its latest state before any recording action, including background completion.

**Voice Transcript**: Recognized and normalized speech for the current turn, shown before agent output. It is separate from interpretation and response.

**Transcription Provider**: The explicitly configured local/cloud recognition contract. Never infer its request shape from a URL. All providers return the same normalized transcript or honest failure; credentials remain host-owned.

**Streaming Reply**: Actual public assistant text for the current in-progress request. It excludes internal thinking/tool records and becomes a completed result only when that request finishes.

**Input Level**: Measured microphone amplitude, not speech probability, task progress or a decorative waveform.

**Coding Target**: An operator-configured host and development-root scope. Ambiguity asks; configuration proves neither connectivity nor an OS filesystem sandbox.

**Voice Capability**: An explicitly installed action available to the Personal Bot. It does not own recording/transcription or grant arbitrary renderer execution.

**Controllable Pi Session**: A live Pi session with an explicit prompt-delivery endpoint. Monitoring grants no control. Accepted/queued delivery does not prove completion. Console and voice use the host control daemon; Attribution names only a Console.

## Pi Sessions Inspection

**Desk Link**: A package-initiated, token-authenticated connection from one Pi machine to one Open DeskOS runtime. It is the only channel through which that machine's Reported Sessions are known, and it never requires Open DeskOS to reach the machine. Control does not travel on this connection: a machine opens a separate control connection to the same listener, gated by a Control Credential.

**Reporting Machine**: A machine with at least one live Desk Link. It is identified by its Desk Link, never by a network address or an SSH alias.

**Reported Session**: A Pi session that Open DeskOS knows only through a Desk Link. It is inspected exactly like a scanned session, and visibility through a Desk Link never implies that it can be managed.

**Desk Link Service**: The Open DeskOS runtime service that accepts Desk Links. It listens on the local network only and authenticates every Desk Link with a per-link token; its channel to the runtime is a Unix socket authenticated by filesystem ownership instead.

**Live Session**: A session whose process runs, either Working or Idle. Live is the default filter; Exited/All can explicitly show history.

**Working Session**: A live session that is streaming a turn. The page states it as `Working...` beside Pi's own braille indicator, and its Session Detail follows the newest event.

**Idle Session**: A live session that is not streaming and is waiting for input. The page states it as `Idle` with no indicator. Its reported status name is `settled`, which is a wire value and not product language.

**Exited Session**: A session whose process ended. It remains available under Exited/All, not the Live default. A turn outcome is not session lifecycle.

**Session Set**: The subset of Pi sessions the Session Filter currently selects. It is the shared candidate set for the Session Switcher and the Session Overview. The Pi status-bar count is a separate, always-running reading and never follows the filter.

**Session Filter**: Transient Overview tabs: Live, Working, Idle, Exited, All. Defaults to Live. The Remote strip advances one named filter button; Detail has no tabs.

**Session Switcher**: The Pi Sessions page's movement between the members of the Session Set with Remote horizontal input. It stops at the first and last member instead of wrapping, and it remembers its selection by session identity rather than position.

**Session Title**: Pi state, full work directory and elapsed label in Detail. No page title or controls. See ADR-0015.

**Session Detail**: The Pi Sessions page's single-session view: the session's own Pi state as the title, its directory, how long it has been running, and its bounded stream of recent Session Events.

**Session Event**: A bounded Pi log/Desk Link entry. ADR-0015 owns per-kind body limits and the 300-event/1 MiB retained tail.

**Folded Reasoning**: One `Thinking...` row per turn by default. Exact `ODESK_PI_REASONING=shown` displays bodies; events still carry bounded text. See ADR-0020.

**Pi Reading Palette**: Pi theme roles quoted inside Session Detail, including prompt/tool surfaces. Page chrome retains Shell semantic tokens. See ADR-0021.

**Tool Box**: A call/result surface whose pairing and outcome follow Pi records. No invented state. See ADR-0021.

**Session Work Directory**: Pi metadata gives the process work directory. The host process table enriches it only when readable; otherwise it stays unknown.

**Session Overview**: The home view: filter tabs and one column of state/goal/directory/activity rows. Selection uses a stroke, not a filled cursor band. See ADR-0015/0022.

## Hosted Pi Control

**Hosted Pi**: A Pi coding session hosted by the Open DeskOS runtime and optionally driven from another machine through a Console. It has a durable identity, keeps running when its Console disconnects, and publishes its events under a position taken from its own session log. Its lifecycle is separate from the outcome of any one turn: cancelling or failing a turn may leave the Hosted Pi alive and idle, while End disposes it.

**Hosted Pi Lifecycle**: Whether the Hosted Pi identity and SDK session remain available: launching, live, ended, or interrupted. While live, its activity is working or idle. End changes lifecycle; Cancel changes the current turn and normally returns the same Hosted Pi to live-idle.

**Hosted Pi Turn Outcome**: The result of one Hosted Pi turn: finished, failed, cancelled, or interrupted. It is recorded separately from Hosted Pi Lifecycle and never by itself releases the Hosted Pi's slot or identity.

**Console**: A Pi session on another machine that has attached to one Hosted Pi and directs its turns. One Console drives one Hosted Pi at a time.

**Control Link**: A separate authenticated connection to the Desk Link listener, one-shot or held during attachment. See ADR-0013.

**Control Credential**: The control secret, distinct from reporting token. It never crosses the wire; nonce/HMAC proves it. See ADR-0013.

**Attach**: A Console binding to one Hosted Pi to receive its events and direct its turns. Attaching replaces rather than shares any previous Console, is idempotent, and is repeatable by Hosted Pi identity. Attaching again continues from the position the Console last applied, so nothing is repeated and nothing is skipped.

**Hosted Pi Position**: A durable log-entry position shared by history/live events. A batch applies atomically; history starts after the position and Attach catches up through an inclusive boundary. No replay buffer or separate counter.

**Control Attribution**: The desk-visible statement of which Console currently drives a Hosted Pi. It stays visible for as long as that control exists and disappears when the Console disconnects; it never takes local touch or keyboard authority away.

## Input, peripherals and runtime channels

**Generic UVC Webcam**: P4 SC2336 standard MJPEG/UAC peripheral with no biometric analysis/storage. See ADR-0004.

**Camera Acceptance**: The CM5 hardware acceptance sequence for the camera peripheral: verify the composite USB identity, resolve the V4L2 video device, and capture one bounded MJPEG frame without storing media.

**Remote Control**: The ESP32-S3 touchscreen device that turns direct touch interaction into navigation input for the Linux display.

**Display Shell**: The shared Electron Shell. CM5 native HDMI content is 1920×1280; the promised geometry matrix also includes 1280×776. Host differences belong in `src/platform/`.

**Cell**: The square layout region a Widget measures. Reference/handheld examples are 348px/186px; viewport width does not predict Cell size. See ADR-0028.

**Minimum Readable Cell**: The Widget-declared minimum for full composition. Larger spans require it; one cell is always honored. See ADR-0028.

**HID Navigation**: Remote Control navigation conveyed to the focused Display Shell as standard USB HID `ArrowLeft` and `ArrowRight` key presses. It remains available whenever USB is enumerated, including while CDC state feedback is synchronizing.

**Channel Token**: A random 32-byte host token authenticating pipe/TCP peers before protocol parsing. Unix retains ownership compatibility. See ADR-0025.

**Runtime Channel**: A companion/control connection with host endpoint resolution and ownership/token authentication. Its protocol remains separate from transport.

**Gamepad**: The renderer-read controller supplying shared intents independently of the S3 Remote. Connected unreadable pads state presence without input. See ADR-0027.

**Navigation Surface**: The Remote Control's paired large previous/next touch targets, which also recognize a horizontal swipe across the screen as the same navigation intent.

**Remote Touchpad**: The Remote Control input surface that emits directional movement, a primary press, and a secondary press to the focused Display Shell.

**Secondary Action**: A Remote Touchpad long-press request offered to the currently focused App control. A control that does not explicitly support it leaves the App unchanged.

**App Initial Focus**: The first Remote Touchpad focus target for an App. An App may declare it; otherwise the first visible enabled interactive control is the target.

**App Focus Mode**: The input mode while a focused App page is active: directional input belongs to that App and never requests page navigation. An App may declare one axis as its primary movement — switching between the items it is showing — while the other axis moves within the current item. Bounded Paging resumes when the App is no longer active.

**Remote Firmware**: A standalone ESP-IDF project under `peripherals/esp32-s3-remote/` that exposes only the Remote Control experience plus HID Navigation. It is a required architecture peripheral with its own hardware acceptance gate; direct shell input remains available before that gate passes.

**Bounded Paging**: Display Shell navigation that stops at the first and last page; navigation input at either boundary leaves the current page unchanged. On a non-interactive page, only left and right request bounded paging; up, down, primary, and secondary leave the page unchanged.

**Remote State Feedback**: The Display Shell's authoritative current-page, interaction mode, and available control-strip actions presented back on the Remote Control after navigation. Before the first state arrives, Remote Control shows an explicit connecting or disconnected state instead of a guessed page. Remote Link state remains available to the Remote Control and its dedicated runtime surface; the Display Shell State Bar stays limited to its network indicator.

**Remote Control Strip**: The Remote Control's plugin-owned contextual action bar. Browse mode offers Previous and Next; App Focus Mode offers directional movement and Select; Back is persistent in every mode. A page that owns strip buttons publishes them as its own authoritative state instead of declaring them in the desktop layout.

**Remote Bridge**: A Node.js systemd user service that owns the active Remote Link and relays Display Shell state to the Remote Control independently of whether the link is wired USB or wireless ESP-NOW. It communicates with the Electron main process over a permission-restricted Unix domain socket and starts with the CM5 graphical user's session.

**Remote Link**: The bidirectional transport between the Remote Control and Remote Bridge: USB HID plus CDC while wired, and ESP-NOW through a future ESP32-C6 gateway while wireless. The wired adapter identifies its CDC device through Remote Firmware's unique `/dev/serial/by-id/` link, never a numbered `ttyACM` path. Its absence never blocks direct Display Shell interaction; reconnection triggers an authoritative state sync.

**C6 Gateway**: The future ESP32-C6 installed with the CM5 that bridges ESP-NOW Remote Link traffic to the Remote Bridge over a 3.3V UART Host Link.

**Host Link**: The 3.3V UART connection between C6 Gateway and CM5 that carries framed Remote Messages.

**Remote Pair**: The preconfigured single ESP32-S3 and C6 Gateway peer relationship secured with ESP-NOW peer keys; only that Remote Control may navigate the Display Shell.

**Wired Vertical Slice**: The first deliverable: Remote Firmware sends HID Navigation over USB, Display Shell publishes authoritative state through Remote Bridge, and the bridge returns it over USB CDC; the wireless adapter boundary is delivered but C6 hardware is not yet deployed.

**Remote Message**: A versioned JSON Lines command or state record shared across wired and wireless Remote Link adapters. In wired operation, HID alone requests navigation and CDC carries authoritative state; in wireless operation, `navigate` records request Display Shell navigation through Remote Bridge rather than keyboard emulation.

**Mali Userspace**: The pinned CM5 CSF firmware/libmali pair. GPU rasterization uses ANGLE; X11 presentation stays software. See ADR-0016.
