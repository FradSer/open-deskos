# The Personal Bot is a system component on every Shell Host

## Status

Accepted

## Context

The Display Shell runs on the CM5 (Linux arm64) and, since ADR-0023, on 64-bit Windows. The Personal Bot did not follow it: `integrations/personal-bot` spawned `arecord`, bound `$XDG_RUNTIME_DIR/open-deskos-personal-bot/agent.sock`, and required that directory. ADR-0025 already answers the transport half of that — a runtime channel is a Unix socket where ownership can authenticate and a named pipe authenticated by the shared channel token where it cannot — and `runtime/linux/src/platform/index.js` already names the voice link's Windows endpoint. So the link was decided and unwired, and the Windows runbook reported voice as unavailable.

Capture is the other half, and it is a real port rather than a switch. A Windows host has no ALSA; it has DirectShow device names, and the honest question is what reads them. The requirement is narrow: same WAV framing, same WebRTC VAD endpointing, same input level, same truthful failures, and a capture that is a fixture the recorder can be tested against rather than a new subsystem with its own state machine.

One more fact shaped the deployment shape: a microphone opened in session 0 has no audio endpoint, so the resident service cannot be a Windows service, and the host is a handheld that suspends on battery mid-capture.

## Decision

- The voice link is a runtime channel like every other link. The host's naming decides the endpoint (`\\.\pipe\open-deskos-personal-bot` on Windows, the runtime-directory socket on Unix), and the same local-channel token authenticates it there, consumed before the voice protocol reads a byte. Where ownership can authenticate, it stays the gate, and a Unix client written before the token existed still reaches the protocol unchanged.
- Capture is the only host-specific piece of the personal bot. A Windows host records through `ffmpeg -f dshow` emitting the same raw signed 16-bit little-endian 16 kHz mono stream on stdout; a Unix host keeps `arecord`. WAV framing, the 640-byte/20ms VAD frames, RMS input level, the 60-silent-frame endpoint, the 4 GiB guard and the temporary-capture lifecycle are one shared path.
- The capture command is selected from the host, and the operator's device string is passed through verbatim. On Windows that value is a DirectShow device name and is required: the Unix default device name means nothing to DirectShow, so an unset or `default` value stops startup with that guidance rather than opening nothing.
- Stopping a Windows capture asks ffmpeg to quit on stdin so the tail of the utterance is flushed, and escalates to termination only after the same grace period the signal path uses. Windows cannot deliver SIGINT, and a forced kill would lose buffered samples.
- The service stays a resident process of its own, started by the logged-on session: an interactive scheduled task with a restart loop on Windows, the user unit with `Restart=on-failure` on a Unix host. It has no lifecycle coupling to the Shell, and an absent service reports voice as unavailable rather than local or simulated.
- Transcription on that host is a declared cloud provider (ADR-0030), because a handheld provisions no local ASR model and a bridge per device is not a thing this host should carry.

## Considered Options

- **A Windows service (Session 0) for the personal bot.** Rejected: no audio endpoint in session 0, so a microphone could never open; the service would be a resident process that cannot do the one job it exists for.
- **Launching the personal bot from the kiosk/Shell launcher.** Rejected: it couples the Personal Bot's lifetime to the Shell's, which the deployment contract explicitly refuses, and a Shell restart loop would then restart a half-finished capture.
- **A PowerShell or WinRT capture helper.** Rejected: it needs its own PCM-to-WAV encoding and its own endpointing, duplicating the shared signal path, and it is a script the host cannot unit test without a microphone.
- **A native N-API capture module built per host.** Rejected as the first port: it needs a C++ toolchain on the device and a build step per host for a thin wrapper over ffmpeg, which the host already can run. The option stays open if ffmpeg ever becomes an unacceptable dependency.
- **Leaving voice unavailable on Windows and keeping capture ALSA-only.** Rejected: the Personal Bot is a system component of the desk runtime, not an optional plugin, so a second supported host that cannot hear a request is a lesser desk.

## Consequences

- A Windows handheld takes a Spoken Turn from a real microphone, transcribes it in the cloud, and answers through the same resident Pi session the reference host uses; the Shell learns nothing new to render it.
- The voice channel on Windows is a named pipe with a token, so the handshake that ADR-0025 published is now spoken by the personal bot service too, from the sealed personal-bot package rather than from the shell's own channel module.
- The host needs `ffmpeg` and an interactive task, both provisioned by an operator script that reports what is missing and installs nothing unless told to; a host without them reports voice as unavailable, which is the truth.
- The personal bot's own Pi run needs a Pi model credential on that host, which the Shell never needs; each desk holds its own, as ADR-0024 requires for Tailscale.
- Capture acceptance on a new host is still hardware acceptance: a real microphone, a spoken request, and a transcript that is the speech that was made.
