# CM5 voice service deployment

The installer packages `integrations/voice-agent` inside each immutable runtime
release and installs its production dependencies with the frozen pnpm lockfile
and lifecycle scripts disabled. Node 22.19.0 or newer and a working pnpm/Corepack
installation are required. The Pi SDK is a voice package dependency, not a global
Pi executable copied from the development machine.

After shell activation, the installer provisions `alsa-utils` (`arecord`), grants
the kiosk user membership in `audio` when that group exists, and enables/restarts
`open-deskos-voice-agent.service`. Existing user managers may need a new login or
a reboot to acquire newly granted audio group membership. Voice has no shell
`Requires`, `Wants`, or graphical-session lifecycle coupling. A missing microphone,
a missing STT key, or failed voice activation does not stop the shell.

## Device-local configuration

Provision configuration as the kiosk user, not root. Create
`~/.config/open-deskos/runtime.env` with mode `0600` for `ODESK_WORKSPACE`;
both Shell and Voice Agent read it. Keep the voice-specific settings below in
`~/.config/open-deskos/voice-agent.env`, also mode `0600`. The installer deliberately
does not create or overwrite either file. Set actual absolute paths on the CM5:

- `ODESK_WORKSPACE`: the shared Open DeskOS writable Git checkout, consumed by
  voice and other system entry points rather than owned by voice. It is explicitly provisioned,
  outside `/opt/open-deskos` (for example under the kiosk user's `~/Developer`).
  This is where coding tools work, never the `current` symlink or release tree.
  The installer does not clone a repository, configure Git identity, or deploy
  changes produced by the agent.
- `ODESK_VOICE_STT_KEY_FILE`: required only when transcription is not the
  device-local loopback bridge; a mode-`0600` file containing the STT credential,
  provisioned through the operator's normal secret-management process. The loopback
  bridge ignores a bearer and needs no credential, so a device using
  `integrations/local-stt-bridge` omits both this variable and its file.
- `ODESK_VOICE_STT_PROVIDER`: optional; defaults to `openai`. It declares the
  request shape the endpoint expects — `openai` is the multipart audio upload,
  `aliyun` is a DashScope multimodal-generation JSON request with the audio
  inlined. Nothing is inferred from the URL, so a desk that declares a provider
  cannot send the wrong body to a gateway that happens to answer either.
- `ALIYUNCS_TOKEN`: the bearer credential for `ODESK_VOICE_STT_PROVIDER=aliyun`,
  read from the service environment rather than a file only this service can
  open. The OpenAI provider keeps using `ODESK_VOICE_STT_KEY_FILE`; the two
  credentials are declared separately on purpose. With the Aliyun provider and no
  `ODESK_VOICE_STT_URL`, the service addresses DashScope's own endpoint; a
  gateway (for example a MaaS proxy) is a device-local URL override.
- `ODESK_VOICE_AUDIO_DEVICE=default`: uses the user's ALSA default input. Override
  only after verifying the actual capture device as that user. On a Windows host
  the value is a DirectShow device name such as `Microphone (2- USB Audio Device)`
  and is required: the Unix default device name means nothing to DirectShow, so
  an unset or `default` value stops startup with that guidance instead of opening
  nothing. The name is what ffmpeg lists, without the `audio=` input prefix ffmpeg
  adds itself; a name this host does not know makes the capture report the
  microphone as unavailable rather than a recording that failed.
- `ODESK_VOICE_STT_URL`: optional; defaults to
  `https://api.openai.com/v1/audio/transcriptions`. Plain HTTP is accepted only
  for loopback hosts when a device-local speech service (for example
  `integrations/local-stt-bridge`) handles transcription; remote hosts still
  require HTTPS and URLs never carry credentials.
- `ODESK_VOICE_STT_MODEL`: optional; defaults to `whisper-1` for the OpenAI
  provider and `qwen3-asr-flash` for the Aliyun one. The loopback bridge
  ignores the field, so a device-local endpoint has no reason to set it.
- `ODESK_VOICE_MODEL`: optional Pi `provider/id` model selection. Configure provider
  authentication separately on the CM5 under the kiosk user's Pi auth storage
  (`~/.pi/agent/auth.json`); the STT key does not authenticate the coding model.
- `ODESK_TASK_TARGETS_FILE`: the voice coordinator's own Hosted Pi target list
  (see @../../integrations/voice-agent/docs/MANAGED_TASKS.md). Declare it in the
  voice service's environment — `voice-agent.env`, or a
  `open-deskos-voice-agent.service.d/*.conf` drop-in when the operator prefers
  to keep it beside the host's `pi-tasks.json`. systemd applies both, and a
  drop-in wins over the env file, so set it in exactly one of them.

Never copy the developer's `.pi`, auth files, `.env`, or `node_modules` to the
CM5. Integration staging excludes these common private/local artifacts; release
packaging copies only `package.json`, `pnpm-lock.yaml`, `src`, and `systemd`.
Do not put secrets in source directories or systemd units.

## On a Windows Shell Host

The Voice Agent is a system component on every supported host, so a 64-bit
Windows host runs the same service with two host-specific pieces: capture through
ffmpeg's DirectShow input instead of ALSA, and the voice link bound as the
`\\.\pipe\open-deskos-voice-agent` named pipe the host's own naming already
declares. A pipe carries no owner, so the channel token in
`%LOCALAPPDATA%\open-deskos\local-channel.token` is what authenticates the
connection, and it is consumed before the voice protocol reads a byte (see
@../../runtime/linux/docs/adr/0025-a-runtime-channel-is-authenticated-by-ownership-or-a-token.md).
The device-local configuration uses the same two environment files as the CM5,
`%LOCALAPPDATA%\open-deskos\runtime.env` and `voice-agent.env`.

```powershell
# What the host is missing, without installing or registering anything
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-voice.ps1 -Report
# Stage the interactive task; -InstallFfmpeg is explicit, never automatic
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-voice.ps1 -InstallFfmpeg -Start
```

The service runs in the logged-on session because a microphone opened in session
0 has no audio endpoint, so it is an interactive scheduled task with a restart
loop — the counterpart of `Restart=on-failure` in the unit above. Acceptance on a
device speaks the published protocol over the host's own endpoint and reports the
states, the transcript and the answer:

```powershell
node scripts\voice-acceptance.mjs
```

The device needs its own Pi authentication for the agent run, which the Shell
does not have and does not need: the Shell only reads remote Pi sessions. A host
that points Pi at an OpenAI-compatible model service declares that provider in
its own `~\.pi\agent\models.json`. The full host runbook, including the ffmpeg
prerequisite and the device-scoped model credential, is
@../../runtime/linux/docs/WINDOWS_HOST.md.

## Operator checks after an approved deployment

Run in the kiosk user's CM5 session:

```sh
command -v arecord
arecord -L
systemctl --user is-active open-deskos-shell.service
systemctl --user is-active open-deskos-voice-agent.service
```

After changing device-local configuration, restart only the voice service:

```sh
systemctl --user restart open-deskos-voice-agent.service
```

The IPC socket is `$XDG_RUNTIME_DIR/open-deskos-voice/agent.sock`; runtime state
is under `${XDG_STATE_HOME:-$HOME/.local/state}/open-deskos-voice`. Service
activity alone does not prove microphone capture, STT authentication, or coding
model authentication. Validate those paths explicitly with an operator-approved
voice interaction; do not publish credentials, audio recordings, or raw logs.

The unit resolves code through `current`; each successful installer activation
restarts it. If an operator manually rolls back `current` using the standalone
runtime updater, restart the voice service afterward too. Rolling back to a
release predating voice may leave voice unavailable; the base shell still runs.
User units, audio packages/group membership, writable checkouts, credentials,
and voice state are outside the runtime release rollback transaction.

Host deployment-contract tests do not establish CM5 hardware acceptance. No
hardware deployment is performed by those tests.

## Current hardware acceptance

The OSPTEK ESP32-P4C6 baseboard microphone is accepted as the CM5 Voice Agent
input. The P4 enumerates over its native USB2.0 data Type-C port as composite
USB device `303a:7002`, with CDC camera metadata and a standard UAC2 microphone.
Linux binds `cdc_acm` and `snd-usb-audio`; the stable capture configuration is:

```sh
ODESK_VOICE_AUDIO_DEVICE=plughw:CARD=Microphone,DEV=0
```

Device acceptance passed repeated signed 16-bit mono 16 kHz captures while the
P4 UVC camera continued streaming MJPEG frames. The
kiosk user's recorder path also produced a complete WAV capture. Raw acceptance
audio is piped into aggregate analysis and is not written to disk. Re-run the
hardware gate after firmware, kernel, cable, or board changes:

```sh
/usr/local/bin/open-deskos-p4-microphone-acceptance
```

The P4 native USB2.0 data port is distinct from the CH343P debug/flash Type-C
port. Both may remain connected: the native port carries UVC+UAC, while CH343P
carries firmware logs and flashing. Model/STT authentication and optional
session-control remain separately provisioned device-local concerns.
