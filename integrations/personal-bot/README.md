# Personal Bot

Resident Pi SDK service with MIC/STT input, streamed Markdown feedback, mandatory Jev intent routing and optional proactive proposals.
Electron is the control/status client.
There is no TTS or wake word.
Linux uses ALSA and a private Unix socket; Windows uses ffmpeg DirectShow and the authenticated `\\.\pipe\open-deskos-personal-bot` channel.

Read [CONTRACT.md](docs/CONTRACT.md) for authorization, intent routing, Hosted Pi, proposals, and open acceptance limits.
Use the [Linux deployment runbook](../../runtime/shell/docs/PERSONAL_BOT_DEPLOYMENT.md) or [Windows runbook](../../runtime/shell/docs/WINDOWS_HOST.md) for host operations.

## Install and configure

Node 22.19+ and pnpm are required.
Linux needs `arecord`, working ALSA and a user runtime directory; Windows needs ffmpeg DirectShow and an interactive logged-on session.
Install as the service user:

```sh
cd integrations/personal-bot
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
```

Configuration files are private (0600 on POSIX; protected user ACLs on Windows):

- `~/.config/open-deskos/runtime.env`: shared `ODESK_WORKSPACE` and optional `ODK_STT_PORT` (default 17840).
- `~/.config/open-deskos/personal-bot.env`: bot-specific paths/provider settings. Authenticate Pi as this user through `/login` or its supported environment, under `PI_CODING_AGENT_DIR` (default `~/.pi/agent`). Optional `ODESK_PERSONAL_BOT_MODEL=provider/model-id` selects the model.
- Both profiles require `TYPESAFE_API_KEY` or protected `ODESK_JEV_KEY_FILE`. Opt into the personal profile through `ODESK_PERSONAL_BOT_CONFIG`; otherwise coding coordination is the default.

STT defaults to the [device-local bridge](../local-stt-bridge/README.md) at `http://127.0.0.1:<ODK_STT_PORT>/inference`, which needs no key.
An invalid port stops startup.
Explicit `ODESK_PERSONAL_BOT_STT_URL` selects another endpoint: HTTPS required except loopback HTTP, redirects disabled.
Only loopback `/inference` gets the credential-free whisper.cpp contract; other OpenAI-style endpoints require a separately provisioned nonempty `ODESK_PERSONAL_BOT_STT_KEY_FILE`.

```sh
ODESK_PERSONAL_BOT_STT_URL=https://api.openai.com/v1/audio/transcriptions
ODESK_PERSONAL_BOT_STT_KEY_FILE=/absolute/private/stt.key
ODESK_PERSONAL_BOT_STT_MODEL=whisper-1
ODESK_PERSONAL_BOT_STT_LANGUAGE=zh
ODESK_PERSONAL_BOT_AUDIO_DEVICE=default
```

`ODESK_PERSONAL_BOT_STT_PROVIDER=aliyun` selects DashScope multimodal-generation JSON explicitly, default model `qwen3-asr-flash`, default DashScope endpoint, and private `ALIYUNCS_TOKEN` instead of a key file.
It sends inline WAV and system transcription context.
Provider selection is never inferred from the URL.
All providers share upload/deadline/response limits and safe errors below.

The coding coordinator's `ODESK_WORKSPACE` must be an existing writable Git checkout outside `/opt/open-deskos`, containing `.agents/skills/open-deskos-widget/SKILL.md`.
It inspects using read/grep/find/ls; source edits and command execution require an explicit Hosted Pi target/project in `ODESK_TASK_TARGETS_FILE`.
No target means unconfigured.
Reviewed capability modules execute with normal service-user access: this is not an OS sandbox.
The personal profile does not require this writable Git checkout.

Missing configuration/auth leaves a reachable error status with capture disabled.
Startup availability is not lasting credential validation.
Restart after configuration changes only through an authorized operational workflow.
Foreground development uses `pnpm start` with exported settings.
The user-service template is `systemd/open-deskos-personal-bot.service`; installed release paths and rollback belong to the deployment runbook.

## User applications

Follow [USER_APPLICATIONS.md](../../runtime/shell/docs/USER_APPLICATIONS.md): delegate `ODESK_WORKSPACE/apps/<id>/manifest.json` and self-contained `index.html` drafts, check worker results/history, then use supported lifecycle tools.
A draft alone does not authorize installation; creating and placing a Widget does.
Do not inject scripts into Shell or run arbitrary installers.
Packages use `allow-scripts` sandboxing with no network, Node, filesystem, parent/preload or persistent app-data API.

Tools: `user_apps_list`, `user_apps_desktop`, `user_app_install`, `user_app_place`, `user_app_rollback`, `user_app_remove`.
The private JSONL endpoint is `$XDG_RUNTIME_DIR/open-deskos-apps/control.sock`; install timeout 30 seconds, others 10 seconds, responses ≤512 KiB.
Never retry mutations automatically; reconcile unknown delivery with the operator.

Resolve one-based page numbers with `user_apps_desktop` before placement (Home 2, Reading 3).
Pass `{pageId, col, row}` with CSS grid-line strings.
Widgets require grid pages; occupied/out-of-bounds cells fail without replacement/relocation.
Apps have individual pages.
Placement never changes verified package bytes or Shell source.

## Protocol and limits

Private socket: `$XDG_RUNTIME_DIR/open-deskos-personal-bot/agent.sock`; directory 0700, socket 0600.
Same-user access only.
LF-delimited JSON (not an HTTP endpoint):

```json
{"v":1,"type":"status"}
{"v":1,"type":"toggle"}
```

Status queries receive an immediate snapshot.
Toggle commands acknowledge after their operation settles, so a recording retry cannot echo the previous error as a new failure.
Connected clients receive state transitions immediately throughout recording and execution:

```json
{"v":1,"type":"status","state":"idle","message":"","transcript":"","level":0}
```

States: `idle`, `recording`, `transcribing`, `thinking`, `error`.
After transcription, `thinking` immediately publishes the recognized plain-text `transcript` before starting Pi.
The display transcript is bounded to 4,096 UTF-16 code units with `[Transcript truncated]` inside the bound; Pi receives the full normalized request.
During `thinking`, `message` contains accumulated visible assistant Markdown received from actual SDK streaming events.
Streaming snapshots coalesce to at most one per 100ms, with identical snapshots suppressed.
State transitions and the authoritative final `idle` reply publish immediately.
Partial and final replies are bounded to 16,384 UTF-16 code units with `[Response truncated]` inside the bound.

The adapter subscribes before each prompt and unsubscribes in `finally`.
It accumulates successful assistant messages from that request, separated by blank lines; thinking, tool arguments/results, and old conversation history never enter feedback.
Failed/retried attempts are discarded without duplicating successful earlier narration.
The final response uses those same accumulated successful messages, rather than searching persistent history.
Failure replaces partial output with safe recovery text and retains the transcript.
A new recording or shutdown clears both fields; late callbacks and pending timers cannot change finished requests.
Busy toggles are ignored, not queued.
Toggle begins recording and a second toggle submits manually.
Recording has no duration deadline.
WebRTC VAD (`@echogarden/fvad-wasm` 0.2.0, mode 2) processes 320-sample/20ms frames at 16kHz.
Speech followed by 60 consecutive silent frames ends the turn after 1.2 seconds.
Silence before speech keeps Listening active.

ALSA raw signed 16-bit mono 16kHz PCM streams to a private file with Node stream backpressure, and the WAV header is finalized when capture stops.
Audio does not accumulate in memory during recording.
The classic WAV format's 32-bit file-size ceiling or a disk write failure is a resource error, never a successful speech endpoint.
Recording status publishes normalized measured RMS `level` (0..1) every five frames, approximately 10Hz; other states reset it to zero.
This is a microphone measurement, not a speech probability.

Provider WAV uploads are bounded to 25,000,000 bytes, checked before reading credentials or audio into bounded upload memory.
Oversize recordings report the upload limit explicitly and are removed rather than uploaded.
Initial silence contributes to the file size and upload limit.
Transcription timeout is 45 seconds, provider response limit 64KiB.
HTTPS is required except configured loopback HTTP, redirects disabled.
Provider error bodies and credentials are not logged or reflected in status.
Input records are bounded to 4KiB and invalid versions/commands close the client.
Status output has a 131,072-byte queued frame budget; a maximally escaped 16,384-unit reply plus 4,096-unit transcript fits together in less than 123,000 bytes.
Slow consumers are disconnected.

Temporary audio lives only in private `capture-*` directories beside the socket.
It is removed on success/failure/shutdown; a replacement socket owner also removes captures left by an interrupted process.
Pi transcripts, tool calls and results persist independently under `$XDG_STATE_HOME/open-deskos-personal-bot/sessions` (default `~/.local/state`).
These contain user speech and coding context: protect and retain/delete them according to local privacy policy.

## Pi runtime

Pi SDK is pinned to `@earendil-works/pi-coding-agent` 1.0.0.
Both resident profiles use the SDK's codemode extension.
Project settings are untrusted; only the operator agent directory supplies session configuration.
Generic write/edit/bash/powershell definitions are denied even on resume. [Managed sessions](docs/CONTRACT.md) owns discovery, batching, partial-effect recovery, loader settings and check-history details; [intent routing](docs/CONTRACT.md) owns active/direct tool behavior.

Pi cache warming reads global settings; this integration does not rewrite them.
An operator who wants no idle provider refresh sets `"cacheWarming": "off"`; session overrides cannot disable it.

## Transcription language and context

Chinese transcription defaults to `zh`. `ODESK_PERSONAL_BOT_STT_LANGUAGE` accepts two or three lowercase letters for an upstream-supported language code (for example `zh` or `en`), or `auto`.
Region tags such as `zh-CN` are rejected; a language hint does not select Simplified versus Traditional Chinese.
Syntactic validation does not guarantee the configured provider supports a particular code.

Loopback HTTP/HTTPS with pathname exactly `/inference` uses whisper.cpp multipart semantics.
Automatic detection sends `language=auto`.
Every request sends `translate=false`, preserving the spoken language, including English.
For other endpoints, including standard OpenAI `/v1/audio/transcriptions`, `auto` omits `language` and no `translate` field is sent.
A loopback URL with a different pathname is not inferred to be whisper.cpp.

`ODESK_PERSONAL_BOT_STT_PROMPT` supplies a transcription example/context through the multipart `prompt` field.
Its default is:

```text
在 Open DeskOS 的 CM5 上，用 Pi Agent 检查 ESP32-P4。按 MIC 说话，按 Back 返回。查看 Markdown、GitHub 和 TypeScript。
```

Set this variable to your own short example or vocabulary context, at most 1,024 UTF-16 code units; an explicitly empty value disables the prompt field.
The override is sent verbatim, not treated as an agent instruction.
Restart the service after configuration changes.
The local mapping to `initial_prompt` follows [whisper.cpp v1.8.2 server source](https://github.com/ggml-org/whisper.cpp/blob/v1.8.2/examples/server/server.cpp#L551-L553).

After the complete response is validated, `opencc-js` pinned at 1.4.2 (`opencc-js/t2cn`, `Converter({ from: 't', to: 'cn' })`) normalizes Chinese transcription to Simplified Chinese.
The display and agent use the same normalized text, subject only to the display length bound.
English spelling, case, punctuation and internal line breaks are preserved; surrounding whitespace is trimmed.
Agent instructions default to Simplified Chinese while respecting explicit requests for another language.

Normalization changes written Chinese forms; it does not repair misheard words.
Vocabulary context may help product-name recognition but cannot guarantee accurate English or mixed-language recognition.
Audio capture quality, provider support, and the configured model still determine recognition quality.
No model download or device configuration change is performed by this adapter.

## Trusted capability modules

Set `ODESK_PERSONAL_BOT_CAPABILITIES` to a JSON array of absolute local `.mjs` module paths in the environment file.
Modules are imported once at startup and must default-export an async function returning Pi tool definitions.
Use the installed SDK `defineTool` with `typebox` parameters; return `{content:[{type:'text',text:'...'}],details:{}}`.
Duplicate/core tool names are rejected.
Capabilities execute with full service-user access, so review them before installation.
They are not downloaded or inferred from transcripts.
Built-in Pi extension discovery is disabled for this headless session.

## Verification boundary

Default tests are offline: real SDK/resource-loading, socket/state/stream/capture fixtures, WASM VAD, STT fake transport, language normalization, lifecycle and recovery contracts.
They do not prove live provider, physical microphone, deployed service or host acceptance.
Open acceptance limits live in the contract.
A real voice/coding acceptance needs separately authorized capture, transcription and verified work on each configured host.
