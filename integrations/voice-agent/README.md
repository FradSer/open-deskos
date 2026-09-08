# Resident voice agent

Independent Linux user service: Remote MIC toggle → ALSA WAV capture → cloud speech-to-text → a persistent Pi SDK coding session. The Electron shell is a control/status client, not the agent host. No wake-word listener or text-to-speech is included.

## Install and configure

Requires Node 22.19+, pnpm, `arecord` from `alsa-utils`, working default ALSA capture, and a user runtime directory. Install as the kiosk user, not root:

```sh
cd integrations/voice-agent
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm typecheck
```

Create `~/.config/open-deskos/voice-agent.env` with mode 0600. Values are paths/configuration, never literal keys:

```sh
ODESK_WORKSPACE=/home/orangepi/Developer/open-deskos
ODESK_VOICE_STT_KEY_FILE=/home/orangepi/.config/open-deskos/stt.key
ODESK_VOICE_STT_URL=https://api.openai.com/v1/audio/transcriptions
ODESK_VOICE_STT_MODEL=whisper-1
ODESK_VOICE_AUDIO_DEVICE=default
```

Provision `stt.key` separately with mode 0600. Authenticate Pi under the same service user using Pi's `/login` or its supported provider environment configuration; do not copy root's credentials. Optional `ODESK_VOICE_MODEL=provider/model-id` selects a model, otherwise Pi uses its configured default/available model. Pi configuration/auth follows `PI_CODING_AGENT_DIR`, default `~/.pi/agent`.

`ODESK_WORKSPACE` identifies the shared Open DeskOS development workspace, not a voice-owned workspace. Voice consumes this system-level setting; other Open DeskOS entry points should use the same setting. The obsolete voice-specific workspace variable is not supported.

The workspace must be an existing writable Git checkout containing `.agents/skills/open-deskos-widget/SKILL.md`, outside `/opt/open-deskos`. Install its runtime dependencies separately. Voice edits this checkout using real Pi read/write/edit/bash tools. It never substitutes canned widget templates. The service unit makes `/opt/open-deskos` read-only; instructions require feature-first tests and passing tests/typecheck before staged activation. This is a trusted coding harness with the service user's normal filesystem/network access, not a general sandbox. It cannot activate releases itself under the read-only service unit; use the operator deployment workflow after verification.

Missing configuration/auth leaves the daemon reachable with an error status and capture disabled. After provisioning or changing the env file, restart it. A successful startup checks availability, not whether remote credentials remain valid forever.

Deployment uses `systemd/open-deskos-voice-agent.service` with directory placeholders substituted by the CM5 deployment scripts. See @runtime/linux/docs/VOICE_AGENT_DEPLOYMENT.md. Foreground development: `pnpm start` with the environment exported.

## Protocol and limits

Private socket: `$XDG_RUNTIME_DIR/open-deskos-voice/agent.sock`; directory 0700, socket 0600. Same-user access only. LF-delimited JSON (not an HTTP endpoint):

```json
{"v":1,"type":"status"}
{"v":1,"type":"toggle"}
```

Each valid command receives an immediate status, and connected clients receive transitions:

```json
{"v":1,"type":"status","state":"idle","message":""}
```

States: `idle`, `recording`, `transcribing`, `thinking`, `error`. The final plain-text agent response is bounded to 1024 characters. Busy toggles are ignored, not queued. Toggle begins recording, a second toggle stops; a 30-second deadline also stops and submits. WAV is mono signed 16-bit 16kHz; hard audio limit 2MB, transcription timeout 45 seconds, response limit 64KiB. HTTPS is required, redirects disabled. Provider error bodies and credentials are not logged or reflected in status. Input records are bounded to 4KiB and invalid versions/commands close the client. Slow consumers are disconnected.

Temporary audio lives only in private `capture-*` directories beside the socket. It is removed on success/failure/shutdown; a replacement socket owner also removes captures left by an interrupted process. Pi transcripts, tool calls and results persist independently under `$XDG_STATE_HOME/open-deskos-voice/sessions` (default `~/.local/state`). These contain user speech and coding context: protect and retain/delete them according to local privacy policy.

## Live session capability

Install the companion `session-control` Pi package from the `pi-packages` repository into target Pi sessions and expose its `bin/pi-session-control.mjs` executable on PATH. Set `PI_SESSION_CONTROL_COMMAND` to its absolute executable path if needed. Its private discovery directory can be overridden with `PI_SESSION_CONTROL_DIR`; it must match target sessions. No shell command string or argument interpolation is used.

Tools `live_sessions` and `send_to_session` exchange one version-1 JSONL request/reply with the CLI via stdin/stdout, with generated `requestId`, a 10-second timeout and 256KiB output cap. A target `sessionId` is an opaque live-instance ID from the list, not the durable `piSessionId`; reload/resume invalidates old live IDs. Default delivery is `followUp`. `accepted`/`queued` never means completion. For the current Pi sessions on a Mac or another SSH host, set `PI_SESSION_CONTROL_SSH_HOST=user@mac.local` and set `PI_SESSION_CONTROL_COMMAND` to the absolute installed remote executable path. The service invokes `ssh -T` with batch authentication, strict host-key checking and a five-second connection timeout; the overall request deadline remains ten seconds. Provision the kiosk user's SSH key and known_hosts separately. The host/path are operator configuration, never model arguments; the remote executable is shell-quoted and the JSON request goes only through stdin. Authentication/host-key/transport failures are reported as failed delivery, never success. The remote extension and executable must use the same remote discovery directory. This service never mutates another session's history.

## Trusted capability modules

Set `ODESK_VOICE_CAPABILITIES` to a JSON array of absolute local `.mjs` module paths in the environment file. Modules are imported once at startup and must default-export an async function returning Pi tool definitions. Use the installed SDK `defineTool` with `typebox` parameters; return `{content:[{type:'text',text:'...'}],details:{}}`. Duplicate/core tool names are rejected. Capabilities execute with full service-user access, so review them before installation. They are not downloaded or inferred from transcripts. Built-in Pi extension discovery is disabled for this headless session.

## Verification scope

Tests exercise state transitions, busy/retry/deadline/shutdown behavior, audio cleanup failures, bounded authenticated multipart STT with a fake transport, private JSONL sockets, unconfigured process startup, actual SDK resource loading, persistent-session options and executable session-control framing. They do not contact an LLM/STT provider or require a physical microphone. Hardware acceptance still requires a real microphone recording, authorized transcription, one verified coding request in the writable checkout, and delivery to a live session with the companion extension loaded.
