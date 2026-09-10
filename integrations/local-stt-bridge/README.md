# Device-local speech-to-text bridge

Loopback-only transcription for the resident voice agent, so voice commands work
without cloud STT credentials. A statically linked `whisper.cpp` server
(`ggml-base`) listens on `127.0.0.1:17840` as a kiosk-user service and answers
OpenAI-style multipart uploads at `/inference` with `{"text": "..."}`.

## Provision (once, on the CM5 as root)

```sh
bash integrations/local-stt-bridge/scripts/provision-stt-bridge.sh
```

The script builds the static server only when missing, downloads the model only
when missing, installs `systemd/open-deskos-stt-bridge.service` for the kiosk
user, then verifies `/health`, asserts the socket binds `127.0.0.1` only, and
transcribes a sample WAV against the `{"text"}` contract from
`features/local-stt-bridge.feature`.

## Voice agent configuration

In `~/.config/open-deskos/voice-agent.env` (mode `0600`):

```sh
ODESK_VOICE_STT_KEY_FILE=/home/orangepi/.config/open-deskos/stt.key
ODESK_VOICE_STT_URL=http://127.0.0.1:17840/inference
ODESK_VOICE_STT_MODEL=whisper-1
```

The key file must exist and be non-empty; the bridge ignores its bearer value on
the loopback interface. Plain HTTP is accepted by the voice agent only for
loopback hosts; remote transcription endpoints still require HTTPS. Restart the
voice service after changing the file.

## Notes

- Qwen3-ASR-1.7B RKNN was evaluated and rejected on current CM5 firmware: its
  audio encoder loads, but `language_model.rkllm` requires rknpu driver
  >= 0.9.7 while the shipped kernel carries builtin 0.9.6, and no vendor kernel
  update is available. Revisit after a firmware upgrade.
- `whisper.cpp` base on RK3588 CPU transcribes faster than realtime
  (~6 s wall for ~11 s of audio including model load), inside the voice
  agent's 45 s transcription deadline.
- The bridge holds no conversation state and never leaves the device. Keep the
  model audible-quality expectations at short-command level; upgrade to a larger
  `ggml` model only after measuring the deadline on real command audio.
