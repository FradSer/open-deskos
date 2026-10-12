# Shell architecture and decisions

The shared Shell runs on Linux, Windows x64 and macOS. CM5/Linux arm64 is the reference host. These records retain stable decision IDs. Acceptance of a decision does not certify every implementation or device.

Read [CONTEXT](../CONTEXT.md) for terms, [runtime README](../README.md) for development/releases, and [CONFIGURATION](CONFIGURATION.md) before changing host settings. Current interfaces belong to [AI_PLUGIN_GUIDE](AI_PLUGIN_GUIDE.md), [USER_APPLICATIONS](USER_APPLICATIONS.md), [ODK_LINK](ODK_LINK.md), [ODK_DATA_SPEC](ODK_DATA_SPEC.md) and [VOICE_FEEDBACK](VOICE_FEEDBACK.md). Product and visual rules belong to [PRODUCT](../../../PRODUCT.md) and [DESIGN](../../../DESIGN.md).

## Current decisions

<a id="adr-0001"></a>
### ADR-0001: Transport-independent Remote Link

The standalone Node.js Remote Bridge owns device I/O and a replaceable transport adapter. The Shell owns page state. Their Unix socket is mode `0600`. Wired input uses USB HID; USB CDC returns state. A future UART/C6/ESP-NOW adapter carries the same versioned JSON Lines. This keeps transport out of Electron and avoids replacing a USB-only design. Wireless deployment requires hardware acceptance; see [C6-GATEWAY](C6-GATEWAY.md).

<a id="adr-0002"></a>
### ADR-0002: Shared runtime and research boundary

CM5 remains the reference host. S3 Remote and P4 camera/microphone have independent hardware gates. Neither blocks boot or direct touch/keyboard use. Prior P4+C6 OS assets and their Apple USB companion are preserved research. They do not define active releases. The current P4 camera is a separate peripheral. ADR-0035 defines the shared source root.

<a id="adr-0003"></a>
### ADR-0003: Verified package lifecycle

The separate User Application name is retired by ADR-0009. Its safety decision remains: snapshot exact draft bytes, verify them in a separate bounded renderer, then publish atomically. Failure preserves the installed revision. Rollback verifies again; removal preserves drafts/user data. [USER_APPLICATIONS](USER_APPLICATIONS.md) owns manifests, placement, sandbox and acceptance. The separate package boundary limits integration but avoids loading generated scripts into Shell globals. Verification proves initial loadability, not all future behavior or live CPU/memory quotas.

<a id="adr-0004"></a>
### ADR-0004: Generic P4 UVC/UAC peripheral

P4 exposes composite USB `303a:7002`: UVC MJPEG 1280x720 at 30 fps and UAC 16-bit mono PCM at 16 kHz. It has no CDC metadata, face/owner recognition, enrollment, expression policy or biometric storage. The Face Agent target is withdrawn. Only capture (`p4_sc2336`), encode/push (`p4_uvc_stream`), microphone (`p4_usb_microphone`) and app-owned descriptors (`usb_descriptors.c`) remain in its firmware.

CM5 uses V4L2 and `/dev/odk-p4-camera`, not a vendor parser or status service. Isochronous alt 0 starts each host session at a fresh frame boundary; bulk left clients joining mid-frame. `scripts/p4-camera-acceptance.sh` checks USB identity, V4L2 MJPEG and one bounded frame without stored media. `scripts/p4-microphone-acceptance.sh` is a separate gate. `idf.py build` under ESP-IDF 6.0.1 proves compilation only. Home column 4 rows 2–3 remain unassigned after the removed analysis tiles.

<a id="adr-0006"></a>
### ADR-0006: Package-initiated reporting

A Pi machine opens its Open DeskOS Link to the desk. No inbound access to the machine is required. The dedicated LAN-only service authenticates a per-link token provisioned out of band. One link reports many sessions and bounded events. Disconnection reports unavailable. A report is neither a synchronized mirror nor control authority. Pulling an endpoint was rejected because it retains the inbound-access problem. ADR-0013 supersedes only the earlier control deferral. [ODK_LINK](ODK_LINK.md) owns reporting and the optional SSH source.

<a id="adr-0009"></a>
### ADR-0009: One plugin model and declared services

Widgets occupy grid cells; Apps own pages. Either may provide a Service Plugin outside the opaque HTML frame. The Futu poller is the first service instance; the existing NAS FutuOpenD remains an external source. A dead service reports unavailable and never blocks Shell startup. Account credentials and network access belong outside the renderer.

The accepted service design couples manifest declarations, verification, lifecycle, named secrets and enforced egress to a package revision. Secrets must use system-owned collection/vault paths, never package bytes, releases or plugin-drawn fields. This avoids a separate integration for each account source. It is not evidence that arbitrary installed HTML packages can declare services today: [USER_APPLICATIONS](USER_APPLICATIONS.md) states their current limits. ADR-0026 extends the original Unix-only service endpoint rule.

<a id="adr-0010"></a>
### ADR-0010: Main-owned weather provider

`src/weather-source.js` owns bounded Open-Meteo requests, in-flight deduplication, a ten-minute freshness interval and a mode-`0600` user-data cache. The renderer requests `odk-weather-status` and performs no provider I/O. Reject failed/non-JSON payloads, missing/non-numeric temperature, values beyond ±100 and missing daily ranges. Publish `live`, `stale`, `unavailable` or `unconfigured`; show no refresh time or Live badge. Never label packaged example data as live.

ADR-0029 replaces only the absent-location rule. Smoke constructs an explicit empty location and stays offline. A contested built-in cell reports an installed package's `occupied-placement` without hiding its catalog or losing its bytes. Weather source/layout/density and package placement checks cover fixtures; provider/network/device evidence remains separate. Existing weather geometry uses a 54–70% content envelope, 28% maximum empty band and 10% occupied floor for sparse readings; overflow/clipping rules remain strict.

<a id="adr-0011"></a>
### ADR-0011: Package appearance without authority

The Shell lends verified package documents theme, resolved tokens, fonts and measured radius. The first frame uses `?theme=`; `odk-user-app-theme` updates appearance without reload. Font routes use `odk-user-app://app/font/<id>`, an allowlist and CORS for opaque frames. `supportFetchAPI` and `corsEnabled` support those assets. No network, Shell DOM, preload or file authority is added; `connect-src 'none'` remains. This avoids vendored palettes or forcing every package update through a Shell release. [USER_APPLICATIONS](USER_APPLICATIONS.md#appearance-theme-tokens-and-fonts) owns authoring. Context/real-renderer tests detect drift from Shell tokens and faces.

<a id="adr-0012"></a>
### ADR-0012: Safe multiline Pi results

Results carry multiline Markdown, optional `toolName` and explicit `truncated: true`. ADR-0015 replaces the former 60-event/256 KiB retention with 300 events/1 MiB and keeps every event kind's bounded body. The local collector reads a 2 MiB tail. Open DeskOS Link event frames are bounded at 1 MiB; runtime replies at 2 MiB. Decode UTF-8 across chunks.

Use local `markdown-it`. Disable raw HTML and executable links; show links as inert text/address and images as alt text. Keep semantic headings, tables, code and lists. A wide table has a named focusable horizontal scroll region; its arrows cannot switch sessions/pages. Pixel uses Zpix without synthetic emphasis. Old reporters that discarded bodies require a reporter update; CSS cannot restore them. This is a bounded tail, not a full archive.

<a id="adr-0013"></a>
### ADR-0013: Separate Open DeskOS Link control

A Console opens its own connection to the existing LAN listener. One-shot requests close it; attachment holds it. Reporting transport/backoff remains separate. A Control Credential is distinct from the reporting token and never travels on the wire. A one-time nonce and HMAC proof authorize control. Validate protocol version explicitly. V2 adds control while V1 reporting remains valid.

The Console identity names its machine and Pi session. Verbs are list, launch, attach, prompt, cancel, end and history; replies are state, event, acknowledgement and error. Disconnect/attach elsewhere means detach. Local input stays available. Attribution follows the held Console connection; a Hosted Pi stays alive without it.

Use durable log-entry position for history and live events. Apply each entry's event batch atomically. Attach catches up through an inclusive boundary, then follows later entries. No replay buffer, resync verb, expiring cursor or separate persisted counter is needed. The service calls the separate Pi host daemon; merging them would let a service restart kill sessions.

The listener is an execution surface with the host user's capability. Keep it LAN-only. HMAC removes replayable-secret exposure, not plaintext confidentiality risk. Reusing the report token, sending the control secret, adding another listener and merging connection lifecycles were rejected. SSH polling would duplicate this capability. ACP/MCP were rejected for missing required authorization, durable resumption and multi-client semantics. [ODK_LINK](ODK_LINK.md) owns provisioning/protocol operation.

<a id="adr-0014"></a>
### ADR-0014: Coordinator and full-capability Hosted Pi

The operator reversed the former edit/test prompt guardrail, then removed direct implementation from the resident coordinator. One Hosted Pi worker capability serves voice and Console requests. It can commit, push, install, deploy, activate releases and restart services under the request's authorization. A transcript is not blanket authorization. Mis-transcribed delegated speech remains an accepted capability risk. No global second confirmation or restricted voice worker was adopted.

Active resident SDKs and host CLIs use Pi 1.0.0; sealed rollback releases stay unchanged.
Register each reviewed capability once as a direct SDK tool.
Jev selects the intent; code activates that intent's execution allowlist.
Code Mode `only` hides separate schemas from the model.
Direct and nested calls use the same parameter validation, executor, and turn-level mutation reservations.
Completion, failure, and cancellation deactivate the selected tools.
The [intent-routing contract](../../../integrations/personal-bot/docs/CONTRACT.md#intent-routing) owns this mechanism.
The coding coordinator also registers `read`, `grep`, `find`, and `ls`.
Generic `write`, `edit`, `bash`, and `powershell` remain denied on resume.
The personal profile also denies inspection built-ins.
Missing configured target/project reports unconfigured.
Report the launch receipt and return.
Do not invent a fallback or poll through the long coding turn.

Registered and active tools define the reachable surface.
This is no filesystem, network, credential, or custom-capability sandbox.
Reviewed capabilities run with service-account permissions.
Scripts have no direct Node, filesystem, network, or timer access.
Auxiliary classifier/image execution is disabled.
Failed calls keep partial output.
Completed side effects do not roll back or authorize retry.

Both coordinator profiles and Hosted Pi treat project settings as untrusted and read only the operator's agent settings scope. A trusted checkout could load/install repository-named extensions, skills, prompts or packages. The worker adds exactly two host-owned factories: SDK codemode and check metadata. DiDi confirmation and the personal profile's exact-current-turn memory grant remain enforced through nested calls.

Keep development-root admission, concurrency cap, durable receipts, truthful outcomes, no interrupted-task replay and no retry of uncertain mutations. Admission is not an OS sandbox. Candidate check evidence records process exit and source samples before/after: tracked content/deletions, executable modes, symlink targets without following them, and nonignored untracked files. Exclude dependencies, ignored files, external services and environment. Matching samples are not immutable snapshots or proof of no intervening changes. Unreadable, unstable or oversized scopes report unavailable.

Checks persist in tool history, not mutation receipts. Request digests identify idempotency, not source candidates. `finished` is a turn outcome; `verification: not_run` means no independent verifier. Exit zero/model prose cannot certify adequate checks. Lessons remain evidence for review, not authority or automatic memory writes. Personal memory still requires explicit user commands. Keeping resident mutation tools, split voice/Console workers and model-selected grant labels were rejected. [Personal Bot operations](PERSONAL_BOT_DEPLOYMENT.md) and its integration documentation own current control procedures.

<a id="adr-0015"></a>
### ADR-0015: Live-first Pi Sessions and Pi reading

Session Overview is the home view. Its transient tabs are Live, Working, Idle, Exited and All; default Live includes running and settled sessions. Exited history remains behind its tab. The status count remains independent. One row shows state, goal, directory and activity. A selection opens Session Detail. Detail has no page title, tabs or controls; Pi's state is its heading, full directory its subtitle and elapsed time sits at the right.

`Working...` uses Pi's ten-frame braille indicator at 80 ms. Reduced motion holds one frame. Idle has no indicator. Prompts wrap to the container. Event bodies keep Pi's text: result 64 KiB, reply 16 KiB, prompt 8 KiB, thought/tool call 4 KiB. Retain at most 300 events and 1 MiB; drop whole oldest events with explicit truncation and memoize unchanged markup. Quote Pi's Markdown, tokenizer and diff palette only inside the transcript. Page surfaces retain `--odk-*` tokens.

Deduplicate one session across reporting machines: prefer events, then newest report. Resolve again in the runtime for older services. Read events from a machine that holds them. Known sessions without events are not missing sessions.

Back/Escape/primary returns from Detail to Overview. Remote Back also exits App Focus Mode; Select re-enters list focus. The list itself ignores Back for bounded paging. Only the visible view owns `data-page-focus`. The Remote strip has one filter button; its persistent Back/Select supply the remaining controls. Horizontal switching stops at either end and keeps identity, not index. Fixture DOM/geometry/routing evidence is separate from physical touch, S3 Back, GPU and screen-reader acceptance.

<a id="adr-0016"></a>
### ADR-0016: CM5 Mali userspace and software presentation

The Rockchip 6.1 image has kbase `g21p0-01eac0`, no usable CSF firmware/blob and no panthor/Mesa 24+ route. Pin CSF firmware and `libmali-valhall-g610-g24p0-x11-gbm.so` together from `linux-6.1-stan-rkr4`; g13p0 exposes only EGL 1.4. `scripts/cm5-gpu-userspace.sh` installs them and diverts Mesa sonames into `odk-mesa/` with `dpkg-divert`. `remove` reverses the installation. Restart the graphical session after either operation.

Select ANGLE `--use-gl=angle --use-angle=gles-egl` with `--disable-gpu-compositing` only for Linux arm64/X11 with the blob. Xorg glamor enables its X11 EGL path. GPU rasterization/WebGL remain accelerated; presentation is a software copy because X11 swaps lose the blob's context. `--use-gl=egl` is not an accepted Chromium 150 implementation. Overrides are `ODK_GPU_BACKEND=mali|default`, `ODK_DISABLE_GPU=1` and `LIBGL_ALWAYS_SOFTWARE=1`.

Do not treat Mesa GLX/llvmpipe as acceleration evidence. Check EGL vendor/version, Xorg glamor and installed pair through `scripts/cm5-acceptance.sh`. Recorded device evidence was ARM EGL 1.5, Mali-G610 glamor and ANGLE with software compositing. A new kernel/DDK requires re-pinning both artifacts/checksums; the firmware interface is `0x1010000`. Mainline panthor plus Mesa 24+ is the cleaner future route and would retire this workaround.

<a id="adr-0017"></a>
### ADR-0017: Release-owned toolchain

`packageManager` and `devEngines.packageManager` must agree exactly; the recorded lockfile pin is `pnpm@11.22.0`. Installer/activation use `COREPACK_ENABLE_PROJECT_SPEC=1`. Corepack ignores `devEngines` alone; ambient defaults caused `ERR_PNPM_BAD_PM_VERSION`. Missing declared pnpm fails explicitly. Upgrades re-pin both declarations and lockfiles deliberately.

Post-activation smoke runs `bash scripts/verify-release.sh` directly. `pnpm run verify-release` can install dependencies inside a sealed release and caused `ERR_PNPM_CMD_SHIM_CHMOD`. A sealed release must not run a dependency pass. `tests/update-runtime-cli.test.js` guards this contract; [runtime README](../README.md) owns release operations.

<a id="adr-0018"></a>
### ADR-0018: Pointer-owned release retention

After successful activation and smoke, the locked transaction prunes only `releases/` directories with `release.json` that neither `current` nor `previous` references. Stray directories survive. Cleanup failure reports stderr without failing activation; CLI `pruned` names reclaimed IDs. Failed activation reclaims nothing. Rollback depth is one release, not arbitrary historical recovery. `tests/runtime-release.test.js` guards success/failure/stray-directory cases.

<a id="adr-0019"></a>
### ADR-0019: Ready Hosted Pi endpoint descriptor

After binding and becoming ready, the daemon atomically publishes `{version, socketPath, stateDir}` in `$XDG_RUNTIME_DIR/odk/hosted-pi/endpoint.json` (directory `0700`, file `0600`). Withdraw it first on shutdown. Open DeskOS Link reads this descriptor, not `pi-tasks.json`; `ODK_HOSTED_PI_SOCKET` remains the isolated override. Require version 1 and an absolute socket path. Malformed data means no host. A publish failure reports stderr but does not stop voice-driven work. This avoids duplicate configuration and discovery that promises an unready socket.

<a id="adr-0020"></a>
### ADR-0020: Fold reasoning by default

Replace each turn's thought bodies with one `Thinking...` row at its first thought. The shared display publishes bodies only for exact `ODK_PI_REASONING=shown`. Main resolves it, the URL carries `piReasoning=shown`, and plugins read `ctx.runtimeConfig.piSessionReasoning`. Typos/booleans stay folded. This changes display only; thought events retain their 4 KiB body/truncation flag. Preserve reading position by the row's place from the newest event. No reasoning control is added to Detail or the Remote strip.

<a id="adr-0021"></a>
### ADR-0021: Tool boxes carry recorded outcomes

Quote Pi's prompt band `userMessageBg` (`#343541`) and tool surfaces `toolPendingBg` (`#282832`), `toolSuccessBg` (`#283228`) or `toolErrorBg` (`#3c2828`). Keep assistant/thought on the base surface. The recorded `toolCall.id`/`toolResult.toolCallId` and `isError` determine pairing/outcome; absent error flag follows Pi's non-error rule. Different identities never merge.

If both identities are absent, pair unnamed calls/results one-to-one in written order, not adjacency. Match surplus results from the newest end of a truncated window. Identity always takes priority. Join a result into a call's box only if that call is the visible preceding row; otherwise retain position and name the tool. Folded thoughts do not split a visible pair. Add no border/radius/shadow/badge.

`boundedEvent` canonicalizes fields; local and Hosted Pi log readers extract them. Old reporters without those fields use the ordered fallback. Pin `--pi-*` roles to `.pi-app-wrapper` transcript content; Overview/filter/title remain semantic Shell surfaces. Pi theme changes need an explicit update. `tests/widget-app-styles.cjs` measures surfaces and joined pairs.

<a id="adr-0022"></a>
### ADR-0022: Selection stroke, no pointer fill

Rows retain the page surface regardless of hover. Only the current session gets an inset `1px` `--odk-stroke-focus` outline; no fill or geometry shift. Keyboard `:focus-visible` remains a separate outer 2px ring. Pointer position is not session state. Keep contrast legible in each theme. The leading cursor remains unrendered. `tests/session-tabs-style.cjs` checks selected/nonselected rows and includes a filter-tab hover control.

<a id="adr-0023"></a>
### ADR-0023: Windows x64 is a supported Shell Host

64-bit Windows is a supported host; Windows on ARM is not. CM5 remains the reference host. `src/platform/` owns process inspection, state/device paths, executable rules and endpoint naming; a second runtime tree was rejected to avoid drifting releases/contracts. ADR-0025/0031 supersede the initial unavailable-link scope. [WINDOWS_HOST](WINDOWS_HOST.md) owns current availability and independent device acceptance.

The optional native reader uses `CreateToolhelp32Snapshot`, `GetProcessTimes` and PEB `ReadProcessMemory`. PowerShell is fallback, not the fidelity authority. A runtime PowerShell P/Invoke probe was rejected because permissions/policy vary. Unreadable work directories stay unknown; absence/build failure cannot block startup. Native artifacts stay out of Git/releases and are built after installation. CM5 bash wrappers and Windows launchers keep separate entry points; macOS/Linux checks cannot prove Windows execution.

<a id="adr-0024"></a>
### ADR-0024: Reuse owner Tailscale

Deployment provisions Tailscale only when absent, as an authorized operator action. Reuse an existing host installation without overwriting configuration or logging in. Do not bundle another pinned copy or store login credentials. Owner login uses `tailscale up`/tray. Report CLI connected, needs-login, stopped or other, and failures as reasons. Shell startup does no provisioning/network I/O. Windows installation needs elevation. Detection/provision/status fixtures do not prove tailnet access; a status source alone does not claim a visible Shell tailnet surface.

<a id="adr-0025"></a>
### ADR-0025: Ownership or Channel Token

Unix channels retain owner checks, directory `0700` and socket `0600`. Never unlink a live listener or anything that is not this user's socket. Replace only an owned stale socket. Where ownership cannot authenticate (pipe/TCP), require a cryptographically random 32-byte host token in `localChannelTokenFile`/`local-channel.token`. Restrict its file to the service user by modes/profile ACL. Creation is automatic on first use.

The first line is `{"v":1,"token":"…"}\n`; compare in constant time and remove the handshake before protocol frames, even in one write. Unix clients without a handshake remain compatible after ownership checks. A presented wrong token always fails; never fall back. Refuse unauthed pipe/TCP before protocol parsing and report each distinct reason once. Existing external Unix Service Plugin clients remain compatible; a Windows port adopts the handshake.

Pipe-name secrecy was rejected because namespaces are enumerable. Native pipe ACLs were not chosen because Node exposes no descriptor API and startup must not require a native module. Requiring tokens for every old Unix client would break an already authenticated contract. [WINDOWS_HOST](WINDOWS_HOST.md#runtime-authentication) owns host provisioning details.

<a id="adr-0026"></a>
### ADR-0026: Endpoint selects transport

A declared `endpoint` wins over historical `socket`. Accept absolute Unix sockets, named pipes and `tcp://host:port`; a bare relative name resolves under the runtime directory. `local-channel.js` owns resolution/authentication consistently. Unix retains modes/ownership; pipes/TCP require ADR-0025 tokens. A poller can declare several desks; one unavailable desk cannot stop others. Credentials remain on the poller.

Co-resident-only services, socket forwarding and mandatory MQTT were rejected because they impose a host/broker dependency. A trusted network alone cannot authorize plugin pushes. [CONFIGURATION](CONFIGURATION.md) and [WINDOWS_HOST](WINDOWS_HOST.md) own endpoint settings.

<a id="adr-0027"></a>
### ADR-0027: Gamepad uses shared intents

The renderer reads a Gamepad through one mapping, separate from the S3 Remote. Unreadable connected pads report presence but drive nothing; they cannot hide readable pads. `page-previous`/`page-next` act before mode branches; directional meanings stay unchanged. `mic` reaches the same microphone entry point.

Timers poll about 60 Hz when connected and every two seconds otherwise; occlusion cannot stop input. Held directions repeat immediately, after about 450 ms, then every 130 ms. Presence appears only while connected, with muted accessible unreadable state. `tests/features/gamepad.feature`, `tests/gamepad-input.test.js` and the actual renderer pad fixture in `tests/pi-sessions-interaction.cjs` own acceptance. Physical presses remain separate. No rebinding, host-specific mapping, analog/triggers or rumble is claimed.

<a id="adr-0028"></a>
### ADR-0028: Widget adapts to its Cell

Measure the layout Cell, not host/window width. Re-compose before dropping whole items in declared order; show omitted counts. A glanceable Widget never scrolls or shrinks below its type floor. Interactive Apps/pages may scroll. Always honor one cell; honor larger spans only if they meet the Widget's Minimum Readable Cell. Retire viewport rules that discard spans.

Promise all themes/pages at 1920×1280 and 1280×776; other sizes are best-effort. `pnpm geometry` uses shared wide fixtures, responsive matrix, density and per-Widget checks for drawn characters, reachable content, spans and type. Labels have a 12px caption floor; Shell state has a 14px data floor. Widget harnesses retain their specific reading floors. This protects fixed-shape cameras/charts/covers without shrinking text. [AI_PLUGIN_GUIDE](AI_PLUGIN_GUIDE.md) owns implementation APIs.

<a id="adr-0029"></a>
### ADR-0029: Resolve only an absent device location

Configured latitude/longitude always win. An explicit empty location disables lookup. Only wholly absent location permits bounded keyless/anonymous main-process geolocation before weather. `ODK_LOCATION_URL` and `ODK_LOCATION_REFRESH_MS` configure endpoint/cache reuse; configuration cannot extend the timeout and there is no within-refresh retry. Failure returns no coordinates and an explicit reason, never a default city or old different place. Snapshots state configured/device provenance. Smoke remains offline. ADR-0010's four instrument states remain unchanged.

<a id="adr-0030"></a>
### ADR-0030: Declare transcription provider

`ODK_PERSONAL_BOT_STT_PROVIDER` declares `openai` multipart (default) or `aliyun` DashScope JSON before file/network access. Do not infer shape from URL or include configured values in errors. OpenAI uses `ODK_PERSONAL_BOT_STT_KEY_FILE`; Aliyun uses `ALIYUNCS_TOKEN`; no credential fallback. A declared cloud provider wins over local `ODK_STT_PORT`/bridge settings.

Both preserve normalization, language/context meaning, 25,000,000-byte upload, 45-second timeout, 64 KiB response and safe failure. [VOICE_FEEDBACK](VOICE_FEEDBACK.md#language-and-provider-contract) owns exact payload rules. URL inference, replacing multipart, a separate ASR fork and remote-readable local file paths were rejected: they break gateways/local contracts or duplicate bounds. Inline audio keeps capture local and removable.

<a id="adr-0031"></a>
### ADR-0031: Resident Personal Bot on every host

Voice uses host-resolved channels and ADR-0025 authentication before protocol parsing. Windows uses `\\.\pipe\odk-personal-bot`; Unix retains owned sockets and old-client compatibility. Only capture is host-specific: `ffmpeg -f dshow` on Windows, `arecord` on Unix. Share signed little-endian 16-bit 16 kHz mono PCM, WAV, RMS, 640-byte/20 ms VAD frames, 60 silent frames, 4 GiB guard and temporary-file cleanup.

Pass the actual DirectShow device name unchanged. Missing/`default` stops Windows startup explicitly. Stop ffmpeg through stdin to flush buffered samples, then terminate after the existing grace period; Windows has no SIGINT path. Use an independent interactive restart-loop task on Windows and `Restart=on-failure` user unit on Unix. Shell restart does not restart capture. Absence is unavailable, never simulated. The handheld uses a declared cloud provider.

Session 0 service capture, coupling to the kiosk launcher and separate PowerShell/WinRT encoding were rejected. A native capture dependency was deferred because ffmpeg avoids a device toolchain. [PERSONAL_BOT_DEPLOYMENT](PERSONAL_BOT_DEPLOYMENT.md) and [WINDOWS_HOST](WINDOWS_HOST.md#personal-bot) own operations; live capture requires separate authorization/acceptance.

<a id="adr-0032"></a>
### ADR-0032: Correlated frame completes remote requests

Pass the bounded request to the helper as a private stdin file; remove it with the exchange. Prompts/projects must never enter process arguments. The correlated response completes the request; stop the helper after it arrives. A later nonzero exit cannot undo that answer. No answer remains a timeout.

Remote project paths follow target admission: absolute POSIX paths without parent segments/control characters. Send them verbatim. Only local projects use local resolution. Waiting for helper exit caused valid answers to time out; requiring a Windows pipe client or repeating target root policy on the desk was rejected. [Personal Bot control documentation](../../../integrations/personal-bot/docs/CONTRACT.md#hosted-pi-setup) owns the transport contract.

<a id="adr-0033"></a>
### ADR-0033: One read-only Open DeskOS Data registry

The main process registers each source once for tile IPC and Personal Bot. `list` reads no sources; `read` follows the source's refresh/state policy without a private cache or force-refresh. The read-only channel keeps request `id` separate from `readingId`; each channel's failure is independent. Both bot profiles use `odk_data` and read again for each question.

Projections retain measured numbers/times, identity and truth states. They drop binary/vendor/firmware details and mark shortened prose. Percent display scaling is shared; undeclared scales cannot be guessed. Nonlive Service Plugins show no holdings. Packages publish only declared data through the validated bridge; it remains untrusted data, never instruction or authorization. [ODK_DATA_SPEC](ODK_DATA_SPEC.md) owns fields, bounds, states and tests.

Snapshot files, renderer-owned truth, one tool per source, direct agent provider integrations and pushing every reading into prompts were rejected. Each duplicates truth, expands credential reach or freezes unused data. Adding write verbs was rejected because mutations already have separate verified lifecycle tools. A package publish operation grants no network, DOM or action authority. Fixtures do not prove spoken/model/device acceptance.

<a id="adr-0034"></a>
### ADR-0034: Panel covers display bounds

On Windows fullscreen is geometry: `isFullScreen()` can be false for a covered display. Show the window, leave maximized state, then apply display bounds rather than work area. Compare actual bounds and retry fullscreen/bounds at most eight times. A persistent mismatch is a defect, not an infinite retry.

The panel is not movable, resizable, maximizable or minimizable. It has no `WS_THICKFRAME` or box buttons. This fixes observed work-area gaps and hand dragging/Win+Down. It is not topmost and does not hide the taskbar; other applications restore host control. The reference host keeps its kiosk geometry. [WINDOWS_HOST](WINDOWS_HOST.md#panel-operation) owns the measured probe and timing.

<a id="adr-0035"></a>
### ADR-0035: Host-neutral shared source root

Use `runtime/shell/`, `tests/features/shell.feature` and `src/platform/` for shared behavior. Linux, Windows x64 and macOS x64/arm64 use one implementation; CM5 remains reference. Keep host/peripheral runbooks and acceptance separate. `runtime/linux` was rejected because its name assigns shared implementation to one host.

Update discovery, imports, staging, skills and repository references together.
The technical namespace is `odk`; the Electron package and CM5 profile launcher use `@odk/shell`.
Current services, channels, environment variables, and state paths use the ODK names defined in [Shell terms](../CONTEXT.md#technical-namespace).
Deployment must transfer required state before activation.
Discovery, topology, import, and asset fixtures verify source changes.
Host checks do not prove device presentation, capture, or physical input.

### ADR-0036: Personal Agent owns the home briefing

The first page uses generated Personal Agent content from the read-only Open DeskOS Data registry.
Fixed plugin contributions no longer define that page.
The Agent uses a separate temporary session without tools, extensions, Skills, or memory.
Source updates invalidate pending output.
Unavailable generation retains explicitly stale content.
The Shell renders literal text and source provenance through the authenticated status channel.
Touch and keyboard navigation remain independent of Agent availability.
[The Personal Bot contract](../../../integrations/personal-bot/docs/CONTRACT.md#home-briefing) owns the protocol and generation limits.
A future mail App uses the same declared data boundary.
A home statement grants no execution authority.

## Current Shell plugin composition

The Electron main process, renderer surfaces, appearance plugins, and Remote Bridge use the local host from [plugin-host.js](../src/plugin-host.js).
Trusted local factories declare versioned ports, required or optional dependencies, and capability names.
The host checks the dependency graph before startup.
It stops consumers before providers and cancels work during shutdown.
Failed plugins attempt to release their resources.
Cleanup failures retain ownership and block initialization over those resources.
Stop failure prevents destroy and registered cleanup.
Repeated shutdown retries incomplete phases without repeating successful operations.
Retained consumers prevent provider cleanup and withdraw their public ports.
Only consumer cleanup can resolve a retained provider port.
Independent plugins can continue to run.

The current composition includes these components:

- The data sources in [data-sources.js](../src/plugins/data-sources.js)
- Personal Bot, Remote Link, the built-in App manager, service notifications, and initial frame status in [system-channels.js](../src/plugins/system-channels.js)
- The package catalog, Futu services, Open DeskOS Data, service refresh, installed Widget/App runtime, and Open DeskOS Data Link in [desk-runtime.js](../src/plugins/desk-runtime.js)
- The appearance declarations in [appearance-plugins.js](../src/renderer/core/appearance-plugins.js)
- The renderer surfaces in [registry.js](../src/renderer/core/registry.js).
- The Remote Bridge listener and transports in [plugin-runtime.js](../../../integrations/remote-bridge/lib/plugin-runtime.js).
- The resident Personal Bot components in [plugin-composition.mjs](../../../integrations/personal-bot/src/plugin-composition.mjs).
- The Hosted Pi task components in [task-composition.mjs](../../../integrations/personal-bot/src/task-composition.mjs).

The CLI can link [appearance declarations](CONFIGURATION.md#appearance-declarations) for existing packaged theme identities.
Main passes the same validated selection to the renderer and installed package context.
These declarations replace palette values while preserving packaged fonts, geometry, and assets.

The read-only [diagnosis plugin](../src/plugin-diagnostics.js) exposes current Main lifecycle states through the authenticated local channel.
The [renderer diagnosis plugin](../src/renderer-diagnostics.js) requests bounded snapshots from known Shell main frames.
The Personal Bot diagnosis plugin reads the resident composition through its negotiated channel capability.
The Remote Bridge diagnosis plugin reads listener and transport states through separate short connections.
The Bridge entry accepts [trusted transport selections](../../../integrations/remote-bridge/README.md#trusted-external-transport-selections) and supports offline declaration inspection.
The Hosted Pi diagnosis plugin reads the task composition through its existing discovered endpoint.
The task daemon also accepts [trusted startup selections](../../../integrations/personal-bot/docs/CONTRACT.md#trusted-hosted-pi-development-selections) for listener, service, and endpoint factories.
Its named runtime port distinguishes Hosted Pi from the resident Personal Bot on the same host type.
The shared [runtime report validator](../src/plugin-runtime-report.js) excludes private errors and data from runtime reports.
The CLI reports renderer snapshots separately and treats unavailable runtime channels as failures.
These states do not certify renderer, source, service, or hardware health.
[Runtime replacement](RUNTIME_PLUGIN_REPLACEMENT.md) owns trusted Host replacement and explicit authenticated activation of saved signed Main selections.
[CONFIGURATION](CONFIGURATION.md#plugin-diagnosis) owns endpoint requirements and diagnostic scope.

Each plugin owns its IPC handlers, subscriptions, timers, or listeners.

The separate [Main control plugin](../src/plugin-control.js) applies explicit runtime enable and disable commands through the existing host lifecycle.
Its authenticated channel does not change startup preferences or the read-only diagnosis contract.
It refuses self-disable, unknown identities, and successful receipts after lifecycle failure.
The CLI marks malformed receipts and lost responses as unknown operation outcomes without automatic replay.
The common dispatcher publishes a bounded, read-only component identity inventory without private errors or runtime data.
The CLI resolves unique online ownership across registered management endpoints before it sends a mutation.
Ambiguous identities and invalid online inventories prevent routing.
Runtime identity prefixes do not determine the selected management channel.
The Bridge transport control plugin uses the same dispatcher with its own authenticated endpoint and transport-only target set.
Its listener dependency keeps transport cleanup separate from control and input channel ownership.
Hosted Pi uses the same dispatcher through an independent management endpoint.
Its partial service stop drains Console connections and their asynchronous disconnect operations while preserving its listener.
Each connection retains its service owner until cleanup succeeds.
Renderer management uses a separate authenticated Main-owned endpoint and a correlated Shell main-frame bridge.
Its controller coordinates lifecycle, placements, pager state, and Remote publication before acknowledgement.
Failed affected surface mounts prevent successful receipts even when the selected factory remains running.
Frame identity checks, response limits, and unknown-outcome failures preserve the existing authorization boundary.
Python and firmware still require applicable deployed-host or physical management acceptance.

Weather owns cancellation of its provider requests and its default device-location requests.
Its source stops new requests, suppresses late cache publication, and drains active refresh operations before cleanup completes.
Legacy injected Weather sources can omit `stop`; the existing source contract remains accepted.
Such sources do not establish cancellation support without separate acceptance evidence.

The kernel publishes frame readiness through [frame-ready.js](../src/frame-ready.js).
The frame status plugin broadcasts Personal Bot status and sends Remote Link status only to the new frame.
Optional providers retain the existing unavailable and disconnected fallback states.
The notification plugin forwards changed reading identities to the current Personal Bot instance.
Stopping either consumer cancels its retained callbacks without stopping its providers.
Open DeskOS Data Link retains its listener until close succeeds, including listeners returned after startup cancellation.
A failed close retains the required data provider and prevents replacement until cleanup succeeds.
Normal Electron exit waits for plugin shutdown before it resumes.
Repeated exit requests share that shutdown operation.
Shutdown failures enter diagnostics before exit resumes.
Source replacement makes Open DeskOS Data use the new source instance.
Open DeskOS Data checks the package catalog again after restart.
It retains published values only when the package revision, name, data declaration, and home declaration stay the same.
Default package registration still clears previous published values.

The appearance plugins declare theme identifiers, local CSS, semantic tokens, and font faces.
The Shell keeps Pixel as its default theme.
Installed package documents use the same declarations.
An unknown theme selection uses Instrument.

Renderer surfaces keep their existing mount and unmount contracts.
Trusted startup composition can select replacement definitions while preserving surface identity, role, dependencies, ports, and permissions.
The registry validates the complete candidate before selecting it or executing factories.
The [built-in guide](AI_PLUGIN_GUIDE.md#trusted-replacement-composition) owns preloaded definitions, trusted development entries, and distribution limits.
Main separates renderer entries from native Main factories and authenticates entry requests against known Shell main frames.
The renderer validates declarations before script loading and validates actual definitions before factory execution.
Optional development stylesheets resolve inside their linked directory and receive an inactive availability check before entry execution.
The registry associates each validated stylesheet URL with its selected definition without changing ordinary relative CSS declarations.

Read [the runtime replacement contract](RUNTIME_PLUGIN_REPLACEMENT.md) when a trusted controller replaces a running JavaScript factory.
Its Renderer programmatic section owns retained placements, App guards, unchanged stylesheet bindings, and shutdown fencing.

The common host starts their declared dependencies before mounting.
Shutdown releases each mounted surface before its factory resources.
Cleanup failures cannot prevent other resources from releasing.

An asynchronous surface release retains its element until cleanup completes.
App transitions execute in request order and await the previous surface release.
Failed activation waits for retained cleanup before the App endpoint and previous foreground are restored.

The [plugin scenarios](../tests/features/plugin-host.feature) define the compatibility and lifecycle checks.
This composition does not load third-party native code or change installed HTML package permissions.
Remote Bridge stops its transports before its socket listener.
Transport removal selects an available fallback and keeps the listener open.
Source checkouts and immutable releases load the same Shell kernel.
The [Personal Bot contract](../../../integrations/personal-bot/docs/CONTRACT.md#plugin-composition) owns its component lifecycle.
Resident runtime disable preserves its service and channel providers while voice work drains through reversible service suspension.
The resident management plugin uses the common dispatcher through an independent authenticated endpoint.
The unified CLI routes resident identities to this endpoint without changing startup preferences.
Management remains available while service or voice channel dependencies restart.
Its [development selection](../../../integrations/personal-bot/docs/CONTRACT.md#trusted-resident-development-selections) selects explicitly trusted native resident entries at startup.
Inspection validates declarations without initializing components or preparing operational directories.
The [Futu Python host](../../../integrations/futu-poller/plugin_host.py) implements synchronous local factory composition with the same versioned-port declarations.
The [Futu integration](../../../integrations/futu-poller/README.md#local-component-plugins) owns its lifecycle and compatibility limits.
Its [development selection](../../../integrations/futu-poller/README.md#trusted-development-replacements) loads explicitly trusted local Python replacements at startup.
Inspection validates declarations without executing selected entry code.
The default Python publisher requires a replaceable connection transport through `odk:futu/transport/v1`.
The publisher owns connected resources and retains the provider after uncertain connection cleanup.
Its local diagnosis API reports actual owned states through a bounded snapshot without provider work or private fields.
The report matches the Shell validator.
The default publisher answers negotiated requests through its existing connection on the owner thread.
A separate Main plugin exposes reports without changing the Futu service port contract.
The [Futu guide](../../../integrations/futu-poller/README.md#negotiated-runtime-diagnosis) owns protocol and transport limits.
The [S3 Remote](../../../peripherals/esp32-s3-remote/README.md#native-component-plugins) uses the heap-free [native host](../../../peripherals/common/README.md).
Its generated descriptors bind actual driver and surface lifecycle operations.
The [P4 Camera](../../../peripherals/esp32-p4-camera/README.md#native-component-plugins) also starts through the native host.
Its typed ports connect storage, I2C, camera, USB, microphone, and video plugins.
Its runbook records cooperative TinyUSB cleanup, retained SDK initialization faults, and separate hardware gates.
The native host exposes caller-owned lifecycle snapshots without driver callbacks, heap allocation, or private resource pointers.
Snapshots retain resource ownership and completed cleanup phases; they do not certify hardware health or provide a firmware operator channel.
Generated native descriptors retain public manifest JSON for bounded runtime reports that match the Shell validator.
Native report serialization preserves lifecycle behavior and does not execute drivers or allocate heap memory.
The full cross-host design below remains a target.
[Plugin coverage](PLUGIN_COVERAGE.md) records current boundaries, local evidence, and remaining completion gates.

Trusted local compositions can pass `replacementPlugins` to [createMainPlugins](../src/plugins/main-composition.js).
Each replacement keeps its built-in identity, host, and kind.
Its provided ports match the current contract or an explicitly retained earlier contract.
The composition checks replacement dependencies before any factory runs.
Invalid replacements fail composition instead of silently selecting the original implementation.
Rejected development additions preserve valid replacements.

The CLI links development replacements with explicit `--replace` and capability grants.
Port checks do not prove method signatures, IPC compatibility, or feature behavior.
Replacement acceptance requires the affected feature scenarios.

The [Weather parity checks](../tests/weather-plugin-parity.test.js) compare default, development-linked, and signed independent source implementations.
The replacement owns provider requests, response decoding, cache handling, and cancellation without importing the default source.
Device-location and reading projection helpers remain explicit shared dependencies.
The [Weather contract](WEATHER_PLUGIN_CONTRACT.md) owns current source, rendered consumer, revision, and cross-process cache evidence.
That contract also records production bootstrap checks and their limits.
Alternative providers and supported-device acceptance remain separate gates.

Quota owns each active provider read through its plugin lifecycle.
Stop cancels native requests and waits for their settlement before a new instance starts.
Cancelled reads return unavailable instead of late quota values.
The [Quota parity checks](../tests/quota-plugin-parity.test.js) compare default and replacement compositions with the same IPC and Open DeskOS Data scenarios.
The signed independent source owns provider requests and lifecycle behavior without default source imports.
The [Quota contract](QUOTA_PLUGIN_CONTRACT.md) owns shared dependencies and current consumer evidence.
Alternative provider compatibility and supported-device acceptance remain unverified.

Pi Sessions and Session Events sources retain callable versioned ports.
Each source owns its pending reads, including parallel requests after another request fails.
Stop prevents new reads and fallback scans, then waits for owned requests to finish.
Cancellation suppresses results while their returned Promise remains pending.
Already completed Promises retain their values.
The SSH source passes its cancellation signal to the native child process.
Stop retains the child until its close event confirms process and stream release.
The [Node child process contract](https://nodejs.org/api/child_process.html#event-close) defines this completion boundary.
Pi sources pass their cancellation signals to individual Open DeskOS Link requests.
Each cancelled request closes its connection without stopping independent requests.
The shared Open DeskOS Link client retains request ownership until socket close.
Client stop cancels all its requests and waits for their connections to close.
Cancellation signals remain local and do not change protocol records or authentication.

The [Pi replacement checks](../tests/pi-plugin-parity.test.js) compare default, development-linked, and signed independent Sessions and Events implementations.
The independent sources own aggregation, projection, parsing, and request lifetime through explicit collection capabilities.
The [Sessions contract](PI_SESSIONS_PLUGIN_CONTRACT.md) and [Events contract](PI_EVENTS_PLUGIN_CONTRACT.md) own shared dependencies and current consumer evidence.
Those contracts also record production bootstrap checks and their limits.
Live collector behavior and supported-device acceptance remain separate gates.

## Proposed target

This approved design target does not certify a shipped API or device behavior.
It does not expand HTML package authority or include preserved P4+C6 research.
The Host Kernel owns startup, validation, dependencies, lifecycle, grants, configuration, and faults.
Features, drivers, services, and transports use separate plugins.
The host keeps windows, State Bar pager, App frames, Back, and overlays.
The [current composition](#current-shell-plugin-composition) describes implemented boundaries.
The replacement acceptance rules below apply to feature conversion.
Later proposals do not require new product capabilities to complete that conversion.

### Replacement acceptance

Use a plugin boundary for a feature, service, transport, or driver with an independent replacement requirement.
Keep internal helpers inside their owning plugin unless they have a separate replacement requirement.
Reuse existing selection and lifecycle interfaces before adding another management mechanism.
Replaceability alone does not require replacement during operation, automatic reload, or new state migration.
Preserve existing management and recovery behavior when selecting another implementation.

Each feature must have an explicit implementation boundary and a working selection path.
The selected implementation must preserve the feature contract, persisted data, and public consumer behavior.
Startup selection establishes replaceability when the feature has no requirement for replacement during operation.
Existing runtime management, authorization, recovery, and package update contracts remain required where applicable.
A minimal alternative implementation can prove selection and consumer compatibility without duplicating the complete default implementation.
Shared behavior checks must cover the applicable contract; a selection marker alone cannot establish functional preservation.

### Proposed Core Manifest v1

This table retains the target vocabulary; it is not the schema for every current host.
Use [Native plugins](NATIVE_PLUGINS.md) for current Shell manifests, trust, distribution, and selection.
Use the [native host contract](../../../peripherals/common/README.md) for firmware descriptors and lifecycle operations.
Fields in this proposal do not independently require implementation during feature conversion.

| Field | Target contract |
| --- | --- |
| `$schema`, `schemaVersion` | Version 1; `https://open-deskos.org/schemas/plugin-manifest.v1.json` |
| `id`, `name`, `version`, `entry` | Stable identity, display name, semantic version, module/factory |
| `kind` | `surface`, `application`, `service`, `transport`, `device-driver`, `processor`, `protocol`, `integration`, `system` |
| `host` | `electron-main`, `electron-renderer`, `remote-bridge`, `esp32-s3`, `esp32-p4`, `python-agent`, `personal-agent` |
| `dependsOn`, `provides`, `requires` | Versioned dependencies/ports; required or optional |
| `permissions`, `configSchema` | Requested capabilities and configuration |
| `health` | Probe mode/interval/timeout; example 5000 ms/1500 ms |
| `distribution` | `system`, `user`, `dev` origin and signature metadata |

Reject cycles and missing required ports before startup.
Inject only granted capabilities.
Stop cancels active work; destroy releases owned resources and ports.
Visual surfaces also mount and unmount.
Faults must preserve neighboring surfaces and direct input.
Health reports remain separate from lifecycle states.
Generic pause, resume, and configurable health probes remain proposals unless an existing host contract defines them.

The existing `ctx.services.get(serviceId)` resolves selected Renderer services.
Read [the current service guidance](AI_PLUGIN_GUIDE.md#supplied-context) before implementing a consumer.
Backend RPC must authenticate callers and allow only declared, granted actions.
Renderer identities cannot authorize requests.
Grid contributions must preserve explicit placement and reject overlap.
Themes must validate semantic tokens and preserve state.
Structured alerts leave display, focus, and dismissal to the host.
`ctx.callBackend` and `kind: 'theme'` remain sketches.
The [appearance declaration contract](CONFIGURATION.md#appearance-declarations) defines current theme implementation guidance.

Main owns windows, CSP, grants, registry, and IPC.
Preload proxies capabilities without domain decisions.
Renderer orders verified modules and routes intents.
The [Remote Bridge contract](../../../integrations/remote-bridge/README.md) owns transport priority and client continuity during handover.
The firmware build generates immutable descriptors and dependency order before compilation.
The [native host contract](../../../peripherals/common/README.md) owns descriptor fields and supported lifecycle operations.
Pure algorithms remain testable on the development host.

The [Native plugin contract](NATIVE_PLUGINS.md) owns implemented CLI commands, discovery, configuration paths, publisher keyrings, and signature enforcement.
Its selection and activation paths retain their existing trust and revision requirements.
Checksums do not establish publisher trust or replace signatures.
Git URL installation, automatic development reload, and a uniform discovery directory remain proposals.
The former 200 ms reload goal is not a guarantee or a feature conversion requirement.

The [feature matrix](PLUGIN_FEATURE_MATRIX.md) maps current replacement requirements and unverified evidence.
It does not require every proposal in this section to become a shipped feature.
Additional reload and event interfaces need a concrete feature requirement before implementation.
Wireless behavior retains its existing hardware acceptance requirements.
These targets authorize no native code execution, downloads, live capture, or production changes.
ADR-0004's Face Agent withdrawal still applies.
