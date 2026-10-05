# Device-local speech-to-text bridge

Loopback-only transcription for the resident personal bot, so voice commands work without cloud STT credentials.
A statically linked `whisper.cpp` server (`ggml-base`) listens on `127.0.0.1` (`ODK_STT_PORT`, default `17840`) as a kiosk-user service and answers OpenAI-style multipart uploads at `/inference` with `{"text": "..."}`.

## Provision (once, on the CM5 as root)

Requires authorization: this builds/downloads assets, installs a service and transcribes a sample on the device.

```sh
bash integrations/local-stt-bridge/scripts/provision-stt-bridge.sh
```

The script builds/downloads missing server/model assets.
It installs `systemd/open-deskos-stt-bridge.service` for the kiosk user.
It checks `/health` and loopback-only binding.
It transcribes sample WAV against the `{"text"}` contract in `features/local-stt-bridge.feature`.

## Personal Bot configuration

The bridge needs no credential or model name and ignores a bearer.
Personal Bot derives its endpoint from `ODK_STT_PORT`.
Declare the port once in private `~/.config/open-deskos/runtime.env` (mode `0600`):

```sh
ODK_STT_PORT=17840
```

The unit carries that default, so a device on the default port needs no `runtime.env` line at all.
Personal Bot uses `http://127.0.0.1:<ODK_STT_PORT>/inference` when `ODESK_PERSONAL_BOT_STT_URL` is absent.
Set that override only for another transcription endpoint.
Keep any local bridge port consistent. `ODESK_PERSONAL_BOT_STT_KEY_FILE` is not needed for a device-local endpoint: the credential is only for an endpoint that is not the loopback bridge.

An invalid `ODK_STT_PORT` fails startup instead of falling back to a cloud endpoint, so a typo can never send audio off the device.

The Personal Bot defaults to Chinese (`zh`), supplies a short mixed-language vocabulary prompt, and normalizes Chinese transcription to Simplified Chinese while keeping Latin terms. `ODESK_PERSONAL_BOT_STT_PROMPT` overrides that context; an explicitly empty value disables it.
Context is limited to 1024 characters.
For this loopback `/inference` endpoint, `ODESK_PERSONAL_BOT_STT_LANGUAGE=auto` sends `language=auto` explicitly because omitting it uses whisper.cpp's English default.
Local transcription sends `translate=false`; it must not translate English words into another language.
Use `zh`, not the unsupported locale tag `zh-CN`.

These changes correct request semantics and output script, not proven model accuracy.
Compare actual Chinese/English commands before upgrading the model or claiming improved recognition.

Voice reaches the bridge over plain HTTP loopback without any credential; remote transcription endpoints still require HTTPS and their own credential file.
Restart the personal bot service after changing the port or the endpoint.

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
