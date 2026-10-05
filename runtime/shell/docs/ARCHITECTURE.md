# Shell architecture and decisions

The shared Shell runs on Linux, Windows x64 and macOS. CM5/Linux arm64 is the reference host. These records retain stable decision IDs. Acceptance of a decision does not certify every implementation or device.

Read [CONTEXT](../CONTEXT.md) for terms, [runtime README](../README.md) for development/releases, and [CONFIGURATION](CONFIGURATION.md) before changing host settings. Current interfaces belong to [AI_PLUGIN_GUIDE](AI_PLUGIN_GUIDE.md), [USER_APPLICATIONS](USER_APPLICATIONS.md), [DESK_LINK](DESK_LINK.md), [DESK_DATA_SPEC](DESK_DATA_SPEC.md) and [VOICE_FEEDBACK](VOICE_FEEDBACK.md). Product and visual rules belong to [PRODUCT](../../../PRODUCT.md) and [DESIGN](../../../DESIGN.md).

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

CM5 uses V4L2 and `/dev/open-deskos-p4-camera`, not a vendor parser or status service. Isochronous alt 0 starts each host session at a fresh frame boundary; bulk left clients joining mid-frame. `scripts/p4-camera-acceptance.sh` checks USB identity, V4L2 MJPEG and one bounded frame without stored media. `scripts/p4-microphone-acceptance.sh` is a separate gate. `idf.py build` under ESP-IDF 6.0.1 proves compilation only. Home column 4 rows 2–3 remain unassigned after the removed analysis tiles.

<a id="adr-0006"></a>
### ADR-0006: Package-initiated reporting

A Pi machine opens its Desk Link to the desk. No inbound access to the machine is required. The dedicated LAN-only service authenticates a per-link token provisioned out of band. One link reports many sessions and bounded events. Disconnection reports unavailable. A report is neither a synchronized mirror nor control authority. Pulling an endpoint was rejected because it retains the inbound-access problem. ADR-0013 supersedes only the earlier control deferral. [DESK_LINK](DESK_LINK.md) owns reporting and the optional SSH source.

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

Results carry multiline Markdown, optional `toolName` and explicit `truncated: true`. ADR-0015 replaces the former 60-event/256 KiB retention with 300 events/1 MiB and keeps every event kind's bounded body. The local collector reads a 2 MiB tail. Desk Link event frames are bounded at 1 MiB; runtime replies at 2 MiB. Decode UTF-8 across chunks.

Use local `markdown-it`. Disable raw HTML and executable links; show links as inert text/address and images as alt text. Keep semantic headings, tables, code and lists. A wide table has a named focusable horizontal scroll region; its arrows cannot switch sessions/pages. Pixel uses Zpix without synthetic emphasis. Old reporters that discarded bodies require a reporter update; CSS cannot restore them. This is a bounded tail, not a full archive.

<a id="adr-0013"></a>
### ADR-0013: Separate Desk Link control

A Console opens its own connection to the existing LAN listener. One-shot requests close it; attachment holds it. Reporting transport/backoff remains separate. A Control Credential is distinct from the reporting token and never travels on the wire. A one-time nonce and HMAC proof authorize control. Validate protocol version explicitly. V2 adds control while V1 reporting remains valid.

The Console identity names its machine and Pi session. Verbs are list, launch, attach, prompt, cancel, end and history; replies are state, event, acknowledgement and error. Disconnect/attach elsewhere means detach. Local input stays available. Attribution follows the held Console connection; a Hosted Pi stays alive without it.

Use durable log-entry position for history and live events. Apply each entry's event batch atomically. Attach catches up through an inclusive boundary, then follows later entries. No replay buffer, resync verb, expiring cursor or separate persisted counter is needed. The service calls the separate Pi host daemon; merging them would let a service restart kill sessions.

The listener is an execution surface with the host user's capability. Keep it LAN-only. HMAC removes replayable-secret exposure, not plaintext confidentiality risk. Reusing the report token, sending the control secret, adding another listener and merging connection lifecycles were rejected. SSH polling would duplicate this capability. ACP/MCP were rejected for missing required authorization, durable resumption and multi-client semantics. [DESK_LINK](DESK_LINK.md) owns provisioning/protocol operation.

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

Select ANGLE `--use-gl=angle --use-angle=gles-egl` with `--disable-gpu-compositing` only for Linux arm64/X11 with the blob. Xorg glamor enables its X11 EGL path. GPU rasterization/WebGL remain accelerated; presentation is a software copy because X11 swaps lose the blob's context. `--use-gl=egl` is not an accepted Chromium 150 implementation. Overrides are `ODESK_GPU_BACKEND=mali|default`, `ODESK_DISABLE_GPU=1` and `LIBGL_ALWAYS_SOFTWARE=1`.

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

After binding and becoming ready, the daemon atomically publishes `{version, socketPath, stateDir}` in `$XDG_RUNTIME_DIR/open-deskos/hosted-pi/endpoint.json` (directory `0700`, file `0600`). Withdraw it first on shutdown. Desk Link reads this descriptor, not `pi-tasks.json`; `ODK_HOSTED_PI_SOCKET` remains the isolated override. Require version 1 and an absolute socket path. Malformed data means no host. A publish failure reports stderr but does not stop voice-driven work. This avoids duplicate configuration and discovery that promises an unready socket.

<a id="adr-0020"></a>
### ADR-0020: Fold reasoning by default

Replace each turn's thought bodies with one `Thinking...` row at its first thought. The shared display publishes bodies only for exact `ODESK_PI_REASONING=shown`. Main resolves it, the URL carries `piReasoning=shown`, and plugins read `ctx.runtimeConfig.piSessionReasoning`. Typos/booleans stay folded. This changes display only; thought events retain their 4 KiB body/truncation flag. Preserve reading position by the row's place from the newest event. No reasoning control is added to Detail or the Remote strip.

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

`ODESK_PERSONAL_BOT_STT_PROVIDER` declares `openai` multipart (default) or `aliyun` DashScope JSON before file/network access. Do not infer shape from URL or include configured values in errors. OpenAI uses `ODESK_PERSONAL_BOT_STT_KEY_FILE`; Aliyun uses `ALIYUNCS_TOKEN`; no credential fallback. A declared cloud provider wins over local `ODK_STT_PORT`/bridge settings.

Both preserve normalization, language/context meaning, 25,000,000-byte upload, 45-second timeout, 64 KiB response and safe failure. [VOICE_FEEDBACK](VOICE_FEEDBACK.md#language-and-provider-contract) owns exact payload rules. URL inference, replacing multipart, a separate ASR fork and remote-readable local file paths were rejected: they break gateways/local contracts or duplicate bounds. Inline audio keeps capture local and removable.

<a id="adr-0031"></a>
### ADR-0031: Resident Personal Bot on every host

Voice uses host-resolved channels and ADR-0025 authentication before protocol parsing. Windows uses `\\.\pipe\open-deskos-personal-bot`; Unix retains owned sockets and old-client compatibility. Only capture is host-specific: `ffmpeg -f dshow` on Windows, `arecord` on Unix. Share signed little-endian 16-bit 16 kHz mono PCM, WAV, RMS, 640-byte/20 ms VAD frames, 60 silent frames, 4 GiB guard and temporary-file cleanup.

Pass the actual DirectShow device name unchanged. Missing/`default` stops Windows startup explicitly. Stop ffmpeg through stdin to flush buffered samples, then terminate after the existing grace period; Windows has no SIGINT path. Use an independent interactive restart-loop task on Windows and `Restart=on-failure` user unit on Unix. Shell restart does not restart capture. Absence is unavailable, never simulated. The handheld uses a declared cloud provider.

Session 0 service capture, coupling to the kiosk launcher and separate PowerShell/WinRT encoding were rejected. A native capture dependency was deferred because ffmpeg avoids a device toolchain. [PERSONAL_BOT_DEPLOYMENT](PERSONAL_BOT_DEPLOYMENT.md) and [WINDOWS_HOST](WINDOWS_HOST.md#personal-bot) own operations; live capture requires separate authorization/acceptance.

<a id="adr-0032"></a>
### ADR-0032: Correlated frame completes remote requests

Pass the bounded request to the helper as a private stdin file; remove it with the exchange. Prompts/projects must never enter process arguments. The correlated response completes the request; stop the helper after it arrives. A later nonzero exit cannot undo that answer. No answer remains a timeout.

Remote project paths follow target admission: absolute POSIX paths without parent segments/control characters. Send them verbatim. Only local projects use local resolution. Waiting for helper exit caused valid answers to time out; requiring a Windows pipe client or repeating target root policy on the desk was rejected. [Personal Bot control documentation](../../../integrations/personal-bot/docs/CONTRACT.md#hosted-pi) owns the transport contract.

<a id="adr-0033"></a>
### ADR-0033: One read-only Desk Data registry

The main process registers each source once for tile IPC and Personal Bot. `list` reads no sources; `read` follows the source's refresh/state policy without a private cache or force-refresh. The read-only channel keeps request `id` separate from `readingId`; each channel's failure is independent. Both bot profiles use `desk_data` and read again for each question.

Projections retain measured numbers/times, identity and truth states. They drop binary/vendor/firmware details and mark shortened prose. Percent display scaling is shared; undeclared scales cannot be guessed. Nonlive Service Plugins show no holdings. Packages publish only declared data through the validated bridge; it remains untrusted data, never instruction or authorization. [DESK_DATA_SPEC](DESK_DATA_SPEC.md) owns fields, bounds, states and tests.

Snapshot files, renderer-owned truth, one tool per source, direct agent provider integrations and pushing every reading into prompts were rejected. Each duplicates truth, expands credential reach or freezes unused data. Adding write verbs was rejected because mutations already have separate verified lifecycle tools. A package publish operation grants no network, DOM or action authority. Fixtures do not prove spoken/model/device acceptance.

<a id="adr-0034"></a>
### ADR-0034: Panel covers display bounds

On Windows fullscreen is geometry: `isFullScreen()` can be false for a covered display. Show the window, leave maximized state, then apply display bounds rather than work area. Compare actual bounds and retry fullscreen/bounds at most eight times. A persistent mismatch is a defect, not an infinite retry.

The panel is not movable, resizable, maximizable or minimizable. It has no `WS_THICKFRAME` or box buttons. This fixes observed work-area gaps and hand dragging/Win+Down. It is not topmost and does not hide the taskbar; other applications restore host control. The reference host keeps its kiosk geometry. [WINDOWS_HOST](WINDOWS_HOST.md#panel-operation) owns the measured probe and timing.

<a id="adr-0035"></a>
### ADR-0035: Host-neutral shared source root

Use `runtime/shell/`, `tests/features/shell.feature` and `src/platform/` for shared behavior. Linux, Windows x64 and macOS x64/arm64 use one implementation; CM5 remains reference. Keep host/peripheral runbooks and acceptance separate. `runtime/linux` was rejected because its name assigns shared implementation to one host.

Update discovery, imports, staging, skills and repository references together. Keep sealed release layouts, service names, channels and persisted paths unchanged. Retain `@fradser/open-deskos-linux-shell`: Electron derives the existing profile from that internal identity. Renaming it requires a separate state migration. Discovery/topology/import/asset fixtures verify the source move; macOS evidence is separate from Windows, CM5, microphones/cameras and physical input.

## Proposed target

This is an approved design target, not a shipped API or device certificate. It does not expand HTML package authority or include preserved P4+C6 research. The Host Kernel would own startup, validation, dependencies, lifecycle, grants, configuration and faults. Features, drivers, services and transports would use separate plugins. The host keeps windows, State Bar pager, App frames, Back and overlays.

### Proposed Core Manifest v1

| Field | Target contract |
| --- | --- |
| `$schema`, `schemaVersion` | Version 1; `https://open-deskos.org/schemas/plugin-manifest.v1.json` |
| `id`, `name`, `version`, `entry` | Stable identity, display name, semantic version, module/factory |
| `kind` | `surface`, `application`, `service`, `transport`, `device-driver`, `processor`, `protocol`, `integration`, `system` |
| `host` | `electron-main`, `electron-renderer`, `remote-bridge`, `esp32-s3`, `esp32-p4`, `python-agent` |
| `dependsOn`, `provides`, `requires` | Versioned dependencies/ports; required or optional |
| `permissions`, `configSchema` | Requested capabilities and configuration |
| `health` | Probe mode/interval/timeout; example 5000 ms/1500 ms |
| `distribution` | `system`, `user`, `dev` origin and signature metadata |

Reject cycles/missing required ports before startup. Inject only grants. Lifecycle: register → init → start, pause/resume, stop → destroy; visual surfaces also mount/unmount. Health reports `healthy`, `degraded`, `failed`, not lifecycle transitions. Stop cancels active work; destroy releases resources/ports. Faults must preserve neighboring surfaces and direct input.

Proposed `ctx.services.get(serviceId)` resolves services. Backend RPC authenticates callers and allows only declared/granted actions; renderer IDs cannot authorize requests. Manifest grid contributions preserve explicit placement and reject overlap. Themes validate semantic tokens and preserve state. Structured alerts leave display/focus/dismissal to the host. `ctx.callBackend` and `kind: 'theme'` remain sketches; use current guidance for code.

Main owns windows/CSP/grants/registry/IPC; preload proxies capabilities without domain decisions; renderer orders verified modules and routes intents. Remote Bridge would prefer USB CDC priority 100 over accepted wireless priority 50 and retain client sockets through handover. ESP-IDF would generate heap-free `.rodata` descriptors and startup order before build. C descriptors contain identity/version/kind/lifecycle and provides/requires port arrays with interface URI, major/minor and optional flag. Pure algorithms remain host-testable.

CLI targets: list, validate, add, remove, link, enable, disable, diagnose, update. Discovery: `plugins.dev/` → user → system. `add <git-url-or-path>` would disclose permissions and require explicit default-deny `y/N` trust consent for third-party/unsigned content. State/config and `trustAcknowledgedAt` would use `~/.config/open-deskos/plugins.json`; signatures would use `/etc/open-deskos/keyring.pub`. Checksums are not trust/signatures. System signature enforcement and development reload need implementation evidence; the former 200 ms reload goal is not a guarantee.

Open work: production versus development reload; inter-plugin events/IPC permissions; verification matrix; wireless after hardware acceptance. These targets authorize no native code, downloads, live capture or production changes. ADR-0004's Face Agent withdrawal still applies.
