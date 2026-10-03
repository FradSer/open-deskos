# A transcription provider is declared, not inferred from the endpoint

## Status

Accepted

## Context

The personal bot transcribes through one shape: a multipart audio upload carrying `model`, `language`, `prompt` and the file, which is the OpenAI transcription contract and what a loopback whisper.cpp bridge imitates. Device-local speech on the reference host already has a service for that, `integrations/local-stt-bridge`, so a CM5 never needs a cloud credential to hear a Spoken Turn.

A second shell host changes that. The 64-bit Windows handheld has no local ASR model provisioned, no bridge, and no ALSA capture, and a bridge plus a model per handheld is a large thing to ask of a machine that mostly displays. The owner's requirement is that voice still work there, and that the cloud path be the one they already pay for: Alibaba Cloud's Qwen ASR.

That API is not a multipart upload. It is a JSON multimodal-generation request whose audio travels inline as a `data:audio/wav;x-pcm-16bit;base64,…` URI (it cannot read a path on the desk), whose transcription context is a `system` message beside the audio, and whose answer arrives as `output.choices[0].message.content[0].text`. Both Alibaba's own endpoint and the MaaS gateway the owner uses accept exactly that shape; both reject the older top-level `messages` form and the OpenAI `/chat/completions` path. The two request shapes are not interchangeable, and a desk that guesses wrong fails at the provider, not locally.

The module already infers one thing from the endpoint: a loopback URL with pathname `/inference` is whisper.cpp, so it gets `language=auto` and `translate=false`. Extending that habit to a cloud provider would mean a URL pattern deciding a vendor's request contract, which breaks the moment a gateway mounts a provider under a different path.

## Decision

- `ODESK_PERSONAL_BOT_STT_PROVIDER` declares the request shape the endpoint expects: `openai` (the multipart upload, the default, unchanged) or `aliyun` (the DashScope JSON request). It is validated with the same validators as language and context, before any file access or network use, and its value never appears in an error.
- Nothing about the provider is inferred from the URL. A gateway, Alibaba's own endpoint, or a future mirror is the same declared provider pointed at a different address.
- The aliyun provider reads its bearer from `ALIYUNCS_TOKEN`, the OpenAI provider keeps reading `ODESK_PERSONAL_BOT_STT_KEY_FILE`. Two providers, two declared credentials; neither provider falls back to the other's.
- The desk's own inputs keep their meaning in the cloud shape: an explicit language code is the provider's language hint, `auto` turns on the provider's language identification instead of omitting the field, inverse text normalization stays off, the transcription context becomes a `system` message and an empty context omits that message, and the Simplified Chinese normalization, the display bound, the 25,000,000-byte upload limit, the 45-second timeout, the 64 KiB response bound and the safe failure vocabulary are unchanged.
- A cloud desk needs no local model: `ODK_STT_PORT` and the bridge belong to the device-local shape, and a declared cloud provider wins over them.

## Considered Options

- **Inferring the shape from the URL path.** Rejected: it makes a request contract a function of a gateway's routing, so the same desk behaves differently behind a proxy, and a wrong guess surfaces as a provider error rather than a configuration error.
- **Replacing the multipart path with the cloud request.** Rejected: the loopback bridge and the OpenAI endpoint are the reference host's contract, and a desk that only speaks JSON would need a local service that speaks it.
- **Keeping the Aliyun request in a separate service or a private fork of the agent.** Rejected: the transcription contract is one contract with two shapes; splitting it duplicates the limits, the normalization and the failure vocabulary that keep a desk honest.
- **Accepting a local file path instead of an inline data URI.** Rejected: the provider cannot read the desk's filesystem, and a data URI keeps the recording a private local artifact that is deleted either way.

## Consequences

- A Windows handheld transcribes with a cloud model and no local ASR install; a CM5 keeps its device-local bridge, and a desk may move between them by changing one declared value.
- Each provider's tests pin the bytes it sends, so a provider change is a failing test rather than a production error; what those tests prove is the request, never recognition accuracy.
- A new provider is a third branch in one module plus one declared value, not a second transcription subsystem.
- The credential a cloud desk needs is an environment value on that device. That is a deliberate departure from the key-file convention, because the operator already carries that token for other Alibaba tooling on the same host; the trade is that any process of the service user can read it.
