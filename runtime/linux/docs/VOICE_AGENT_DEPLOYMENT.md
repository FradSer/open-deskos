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
- `ODESK_VOICE_STT_KEY_FILE`: a mode-`0600` device-local file containing the STT
  credential. Provision through the operator's normal secret-management process.
- `ODESK_VOICE_AUDIO_DEVICE=default`: uses the user's ALSA default input. Override
  only after verifying the actual capture device as that user.
- `ODESK_VOICE_STT_URL`: optional; defaults to
  `https://api.openai.com/v1/audio/transcriptions`. Plain HTTP is accepted only
  for loopback hosts when a device-local speech service (for example
  `integrations/local-stt-bridge`) handles transcription; remote hosts still
  require HTTPS and URLs never carry credentials.
- `ODESK_VOICE_STT_MODEL`: optional; defaults to `whisper-1`.
- `ODESK_VOICE_MODEL`: optional Pi `provider/id` model selection. Configure provider
  authentication separately on the CM5 under the kiosk user's Pi auth storage
  (`~/.pi/agent/auth.json`); the STT key does not authenticate the coding model.
- `PI_SESSION_CONTROL_COMMAND`: executable for the session-control tools;
  provision it separately on the target session host if those tools are needed.
- `PI_SESSION_CONTROL_SSH_HOST`: optional authenticated SSH host for controlling
  sessions on another machine. With this set, the command above must be an
  absolute executable path on that host. Configure kiosk-user SSH keys and
  known_hosts separately; prompts travel through stdin, never shell arguments.

Never copy the developer's `.pi`, auth files, `.env`, or `node_modules` to the
CM5. Integration staging excludes these common private/local artifacts; release
packaging copies only `package.json`, `pnpm-lock.yaml`, `src`, and `systemd`.
Do not put secrets in source directories or systemd units.

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

## Current acceptance limits

Read-only device inspection for this implementation found Node 22.14.0 under
kiosk user `orangepi`, below the supported minimum. That user had no Pi auth,
voice env file, or suitable developer checkout. Root's separate Pi authentication
was not read or copied. `arecord -l` enumerated a capture device; that does not
prove the default input records usable speech.

Host runtime unit tests and smoke pass, as do voice-service tests/typecheck,
companion session-control tests/typecheck and dedicated Electron voice-status
checks. Full runtime E2E did not pass: Pi Sessions density at 960×640 reported
24% fill outside its configured band, and the App interiors subtest failed.
These failures are outside the voice status selectors, but still block claiming
a verified release. No CM5 release was activated during this implementation.

Before device acceptance: provision a supported Node, a kiosk-owned checkout and
model/STT authentication, install session-control on the intended session host,
clear release verification failures, then stage and test a real voice request.
The already-running interactive Pi sessions must explicitly load the extension;
monitor visibility alone never grants a control endpoint.
