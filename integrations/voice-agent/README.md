# Resident voice agent

For configurable personal Skills, private `MEMORY.md`, and confirmed DiDi ride-hailing, see [Personal voice assistant](docs/PERSONAL_AGENT.md). Set `ODESK_VOICE_AGENT_CONFIG` to opt in; the coding profile below remains the default. The personal profile excludes native shell/filesystem tools and uses separate sessions and transaction state.

Independent Linux user service: Remote MIC toggle → streamed ALSA WAV capture with local WebRTC endpointing → cloud speech-to-text → a persistent Pi SDK coding session. The Electron shell is a control/status client, not the agent host. No wake-word listener or text-to-speech is included.

## Install and configure

Requires Node 22.19+, pnpm, `arecord` from `alsa-utils`, working default ALSA capture, and a user runtime directory. Install as the kiosk user, not root:

```sh
cd integrations/voice-agent
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
```

Create `~/.config/open-deskos/runtime.env` with mode 0600 for shared runtime configuration. Both the Shell and voice agent read `ODESK_WORKSPACE` from this file:

```sh
ODESK_WORKSPACE=/home/orangepi/Developer/open-deskos
```

Create `~/.config/open-deskos/voice-agent.env` with mode 0600 for voice-only settings. Values are paths/configuration, never literal keys:

```sh
ODESK_VOICE_STT_KEY_FILE=/home/orangepi/.config/open-deskos/stt.key
ODESK_VOICE_STT_URL=https://api.openai.com/v1/audio/transcriptions
ODESK_VOICE_STT_MODEL=whisper-1
ODESK_VOICE_STT_LANGUAGE=zh
ODESK_VOICE_AUDIO_DEVICE=default
```

For device-local speech without cloud credentials, run an OpenAI-compatible
transcription service on loopback (for example `integrations/local-stt-bridge`)
and point the URL at it: plain HTTP is accepted only for loopback hosts
(`localhost`, `127.0.0.0/8`, `::1`); every other host still requires HTTPS.
The key file must still exist and be non-empty; its bearer value is verified by
the local service. Example:

```sh
ODESK_VOICE_STT_URL=http://127.0.0.1:17840/inference
```

Provision `stt.key` separately with mode 0600. Authenticate Pi under the same service user using Pi's `/login` or its supported provider environment configuration; do not copy root's credentials. Optional `ODESK_VOICE_MODEL=provider/model-id` selects a model, otherwise Pi uses its configured default/available model. Pi configuration/auth follows `PI_CODING_AGENT_DIR`, default `~/.pi/agent`.

`ODESK_WORKSPACE` identifies the shared Open DeskOS development workspace, not a voice-owned workspace. It is loaded from `~/.config/open-deskos/runtime.env`; voice-only settings remain in `voice-agent.env`. Other Open DeskOS entry points use the same shared runtime setting. The obsolete voice-specific workspace variable is not supported.

The workspace must be an existing writable Git checkout containing `.agents/skills/open-deskos-widget/SKILL.md`, outside `/opt/open-deskos`. Install its runtime dependencies separately. Voice edits this checkout using real Pi read/write/edit/bash tools. It never substitutes canned widget templates. The service unit makes `/opt/open-deskos` read-only; instructions require feature-first tests and passing tests/typecheck before staged activation. This is a trusted coding harness with the service user's normal filesystem/network access, not a general sandbox. It cannot activate releases itself under the read-only service unit; use the operator deployment workflow after verification.

Missing configuration/auth leaves the daemon reachable with an error status and capture disabled. After provisioning or changing the env file, restart it. A successful startup checks availability, not whether remote credentials remain valid forever.

Deployment uses `systemd/open-deskos-voice-agent.service` with directory placeholders substituted by the CM5 deployment scripts. See @runtime/linux/docs/VOICE_AGENT_DEPLOYMENT.md. Foreground development: `pnpm start` with the environment exported.

## Resident user applications

For user requests to create an installable Widget or App, use the user application lifecycle rather than editing Shell plugins. Follow @runtime/linux/docs/USER_APPLICATIONS.md: write a draft under `ODESK_WORKSPACE/apps/<id>` with `manifest.json` and self-contained `index.html`, then run the available project checks. Call `user_app_install` only after the user explicitly authorizes installation or update. User-application draft instructions take precedence over the older built-in widget engineering skill; do not inject generated scripts into the Shell or run arbitrary install scripts. Applications are restricted to a strict `allow-scripts` sandbox with no parent/preload access, network, Node APIs, or persistent app-data API in this slice.

The resident tools `user_apps_list`, `user_apps_desktop`, `user_app_install(id, placement?)`, `user_app_place(id, placement)`, `user_app_rollback(id)`, and `user_app_remove(id)` use the private `$XDG_RUNTIME_DIR/open-deskos-apps/control.sock` JSONL protocol. Install has a 30-second deadline; other operations have a 10-second deadline; responses are capped at 512 KiB. Mutation operations are never retried automatically. If a timeout or transport failure leaves the outcome unknown, report that uncertainty and ask for operator verification before attempting another mutation.

A request to create and put a Widget on a page authorizes installation. First call `user_apps_desktop` to resolve one-based page numbers to stable IDs and inspect occupied rectangles. Home is page 2 and Reading page 3. Pass `{pageId, col, row}` using CSS grid line strings (`"1"` or `"1 / 3"`) to install or place. Only grid pages accept Widgets; occupied or out-of-bounds cells are rejected without overwriting or silently relocating anything. Apps have individual pages, not a shared User Applications collection page. Placement changes never edit Shell source or alter verified package bytes.

## Protocol and limits

Private socket: `$XDG_RUNTIME_DIR/open-deskos-voice/agent.sock`; directory 0700, socket 0600. Same-user access only. LF-delimited JSON (not an HTTP endpoint):

```json
{"v":1,"type":"status"}
{"v":1,"type":"toggle"}
```

Status queries receive an immediate snapshot. Toggle commands acknowledge after their operation settles, so a recording retry cannot echo the previous error as a new failure. Connected clients receive state transitions immediately throughout recording and execution:

```json
{"v":1,"type":"status","state":"idle","message":"","transcript":"","level":0}
```

States: `idle`, `recording`, `transcribing`, `thinking`, `error`. After transcription, `thinking` immediately publishes the recognized plain-text `transcript` before starting Pi. The display transcript is bounded to 4,096 UTF-16 code units with `[Transcript truncated]` inside the bound; Pi receives the full normalized request. During `thinking`, `message` contains accumulated visible assistant Markdown received from actual SDK streaming events. Streaming snapshots coalesce to at most one per 100ms, with identical snapshots suppressed. State transitions and the authoritative final `idle` reply publish immediately. Partial and final replies are bounded to 16,384 UTF-16 code units with `[Response truncated]` inside the bound.

The adapter subscribes before each prompt and unsubscribes in `finally`. It accumulates successful assistant messages from that request, separated by blank lines; thinking, tool arguments/results, and old conversation history never enter feedback. Failed/retried attempts are discarded without duplicating successful earlier narration. The final response uses those same accumulated successful messages, rather than searching persistent history. Failure replaces partial output with safe recovery text and retains the transcript. A new recording or shutdown clears both fields; late callbacks and pending timers cannot change finished requests. Busy toggles are ignored, not queued. Toggle begins recording and a second toggle submits manually. Recording has no duration deadline: local WebRTC VAD (`@echogarden/fvad-wasm` pinned at 0.2.0, mode 2) processes 320-sample/20ms frames at 16kHz and ends a turn after speech followed by 60 consecutive silent frames (1.2 seconds). Silence before speech keeps Listening active.

ALSA raw signed 16-bit mono 16kHz PCM streams to a private file with Node stream backpressure, and the WAV header is finalized when capture stops. Audio does not accumulate in memory during recording. The classic WAV format's 32-bit file-size ceiling or a disk write failure is a resource error, never a successful speech endpoint. Recording status publishes normalized measured RMS `level` (0..1) every five frames, approximately 10Hz; other states reset it to zero. This is a microphone measurement, not a speech probability.

Provider WAV uploads are bounded to 25,000,000 bytes, checked before reading credentials or audio into bounded upload memory. Oversize recordings report the upload limit explicitly and are removed rather than uploaded. Initial silence contributes to the file size and upload limit. Transcription timeout is 45 seconds, provider response limit 64KiB. HTTPS is required except configured loopback HTTP, redirects disabled. Provider error bodies and credentials are not logged or reflected in status. Input records are bounded to 4KiB and invalid versions/commands close the client. Status output has a 131,072-byte queued frame budget; a maximally escaped 16,384-unit reply plus 4,096-unit transcript fits together in less than 123,000 bytes. Slow consumers are disconnected.

Temporary audio lives only in private `capture-*` directories beside the socket. It is removed on success/failure/shutdown; a replacement socket owner also removes captures left by an interrupted process. Pi transcripts, tool calls and results persist independently under `$XDG_STATE_HOME/open-deskos-voice/sessions` (default `~/.local/state`). These contain user speech and coding context: protect and retain/delete them according to local privacy policy.

## Managed Pi tasks on CM5 and Mac

The voice coordinator exposes `coding_targets`, `coding_task_start`, `coding_task_status`, `coding_tasks_list`, and `coding_task_cancel`. Each configured host owns an independent session daemon; SSH carries bounded control requests, not the coding lifetime. Closing voice feedback does not cancel a session. A session is persistent and steerable: it survives across turns, accepts further instructions, and can also be attached to, steered, cancelled, and ended from a Console on another machine under a credential separate from reporting. See @docs/MANAGED_TASKS.md for installation, states, slots, and configuration.

The obsolete `pi-session-control` executable bridge has been removed. A hosted session creates its own Pi SDK session rather than impersonating or editing another interactive session, and it does not imply access to sessions someone started in a terminal. Such a session persists across turns and can be driven from a Console, while staying distinct from the resident voice agent's own conversation.

Task acceptance is not completion. Hosted Pi Lifecycle (`launching`, `live`, `ended`, `interrupted`) is separate from live activity (`working` or `idle`) and from the last Hosted Pi Turn Outcome (`finished`, `failed`, `cancelled`, `interrupted`). The compatible v1 wire still projects working/idle as `running`/`settled`. A finished turn is not verified success: verification stays `not_run` unless a separate verifier supplies evidence. Unknown mutation outcomes retain the task and mutation identities for status reconciliation and are never retried blindly. A daemon restart marks launching or working sessions interrupted and never replays their prompts; their persisted session logs remain history-readable.

## Transcription language and context

Chinese transcription defaults to `zh`. `ODESK_VOICE_STT_LANGUAGE` accepts two or three lowercase letters for an upstream-supported language code (for example `zh` or `en`), or `auto`. Region tags such as `zh-CN` are rejected; a language hint does not select Simplified versus Traditional Chinese. Syntactic validation does not guarantee the configured provider supports a particular code.

For HTTP or HTTPS loopback URLs whose pathname is exactly `/inference`, the adapter uses whisper.cpp multipart semantics: automatic detection explicitly sends `language=auto`, and every request sends `translate=false` to preserve the spoken language, including English. For other endpoints, including standard OpenAI `/v1/audio/transcriptions`, `auto` omits `language` and no `translate` field is sent. A loopback URL with a different pathname is not inferred to be whisper.cpp.

`ODESK_VOICE_STT_PROMPT` supplies a transcription example/context through the multipart `prompt` field. Its default is:

```text
在 Open DeskOS 的 CM5 上，用 Pi Agent 检查 ESP32-P4。按 MIC 说话，按 Back 返回。查看 Markdown、GitHub 和 TypeScript。
```

Set this variable to your own short example or vocabulary context, at most 1,024 UTF-16 code units; an explicitly empty value disables the prompt field. The override is sent verbatim, not treated as an agent instruction. Restart the service after configuration changes. The local mapping to `initial_prompt` follows [whisper.cpp v1.8.2 server source](https://github.com/ggml-org/whisper.cpp/blob/v1.8.2/examples/server/server.cpp#L551-L553).

After the complete response is validated, `opencc-js` pinned at 1.4.2 (`opencc-js/t2cn`, `Converter({ from: 't', to: 'cn' })`) normalizes Chinese transcription to Simplified Chinese. The display and agent use the same normalized text, subject only to the display length bound. English spelling, case, punctuation and internal line breaks are preserved; surrounding whitespace is trimmed. Agent instructions default to Simplified Chinese while respecting explicit requests for another language.

Normalization changes written Chinese forms; it does not repair misheard words. Vocabulary context may help product-name recognition but cannot guarantee accurate English or mixed-language recognition. Audio capture quality, provider support, and the configured model still determine recognition quality. No model download or device configuration change is performed by this adapter.

## Trusted capability modules

Set `ODESK_VOICE_CAPABILITIES` to a JSON array of absolute local `.mjs` module paths in the environment file. Modules are imported once at startup and must default-export an async function returning Pi tool definitions. Use the installed SDK `defineTool` with `typebox` parameters; return `{content:[{type:'text',text:'...'}],details:{}}`. Duplicate/core tool names are rejected. Capabilities execute with full service-user access, so review them before installation. They are not downloaded or inferred from transcripts. Built-in Pi extension discovery is disabled for this headless session.

## Verification scope

Tests exercise public SDK text events across tool turns and retries, subscription cleanup and history isolation, transcript-before-prompt publication, bounded/coalesced pending snapshots, final/error authority and late-callback isolation, main callback forwarding, state transitions, busy/retry/no-deadline/shutdown behavior, streamed WAV headers and disk backpressure, partial PCM frames, measured RMS, deterministic 60-frame endpointing, real local WASM silence classification, capture/audio cleanup failures, 25,000,000-byte authenticated multipart STT with a fake transport, exact default/override/disabled transcription context, endpoint-specific auto/translation fields, real OpenCC mixed-language normalization and unchanged English, normalized display/agent identity, safe language/prompt startup validation, maximally escaped combined transcript/reply JSONL sockets, unconfigured process startup, actual SDK resource loading, persistent-session options and managed-task JSON framing. They do not contact an LLM/STT provider or require a physical microphone. Hardware acceptance still requires a real microphone recording, authorized Chinese transcription, one verified coding request in an approved checkout, and managed-task start/status/cancel acceptance on each configured host.
