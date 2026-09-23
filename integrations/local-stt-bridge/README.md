# Device-local speech-to-text bridge

Loopback-only transcription for the resident voice agent, so voice commands work
without cloud STT credentials. A statically linked `whisper.cpp` server
(`ggml-base`) listens on `127.0.0.1` (`ODK_STT_PORT`, default `17840`) as a kiosk-user service and answers
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

The bridge needs no credential and no model name: it ignores a bearer, and the
voice agent derives its endpoint from `ODK_STT_PORT`, so the desk declares the
port once, in `~/.config/open-deskos/runtime.env` (mode `0600`):

```sh
ODK_STT_PORT=17840
```

The unit carries that default, so a device on the default port needs no
`runtime.env` line at all. The voice agent reads the same value and uses
`http://127.0.0.1:<ODK_STT_PORT>/inference` whenever `ODESK_VOICE_STT_URL` is
not set; set that variable explicitly only to transcribe somewhere else, and
never with a port that disagrees with this one. `ODESK_VOICE_STT_KEY_FILE` is
not needed for a device-local endpoint: the credential is only for an endpoint
that is not the loopback bridge.

An invalid `ODK_STT_PORT` fails startup instead of falling back to a cloud
endpoint, so a typo can never send audio off the device.

The Voice Agent defaults to Chinese (`zh`), supplies a short mixed-language vocabulary prompt, and normalizes Chinese transcription to Simplified Chinese while keeping Latin terms. `ODESK_VOICE_STT_PROMPT` overrides that context; an explicitly empty value disables it. Context is limited to 1024 characters. For this loopback `/inference` endpoint, `ODESK_VOICE_STT_LANGUAGE=auto` sends `language=auto` explicitly because omitting it uses whisper.cpp's English default. Local transcription sends `translate=false`; it must not translate English words into another language. Use `zh`, not the unsupported locale tag `zh-CN`.

These changes correct request semantics and output script, not proven model accuracy. Compare actual Chinese/English commands before upgrading the model or claiming improved recognition.

Voice reaches the bridge over plain HTTP loopback without any credential; remote
transcription endpoints still require HTTPS and their own credential file.
Restart the voice service after changing the port or the endpoint.

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
