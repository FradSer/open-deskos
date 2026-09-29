# Voice language correction

User reports Traditional Chinese output and inaccurate English terms. Normalize validated transcripts to Simplified Chinese with a maintained OpenCC converter, preserving Latin spelling, punctuation and identifiers. Both displayed input and the Agent prompt use the same normalized transcript. Agent replies default to Simplified Chinese unless the user explicitly requests another language.

For recognition, supply a short mixed-language transcription context containing actual product vocabulary; allow operator override or explicit disable with ODESK_VOICE_STT_PROMPT. Bound context length to1024 UTF-16 code units. Do not guess substitutions after transcription or claim proven recognition improvement from mocked tests.

Default language remains zh for Chinese-dominant speech. Accept language codes, not unsupported zh-CN locale tags. For the known loopback whisper.cpp /inference endpoint, auto must be sent explicitly; omission uses its English server default. Standard OpenAI-style transcription uses omission for auto. Keep local translate=false to avoid translating English content; don't send that local-only switch to other endpoints.

Verify real converter with mixed Traditional/Latin fixtures, multipart prompt/backend-specific auto contract, validation/error bounds and startup wiring. No model replacement, cloud migration, device deployment or real audio accuracy claim without separately measured hardware evidence.

Research: whisper.cpp v1.8.2 examples/server/server.cpp (`prompt` to initial_prompt, default language en); OpenAI transcription request language is ISO language code. opencc-js1.4.2 provides bundled pure-JavaScript t2cn conversion and declarations without native addons.

## Cloud transcription keeps the same contract in a different shape

A cloud transcription provider is declared, not inferred, and it receives the same inputs in its own request shape. Aliyun's Qwen ASR takes the context as a `system` message beside the audio instead of a multipart `prompt` field, an empty context omits that message rather than sending an empty one, and the captured WAV travels inline as a `data:audio/wav;x-pcm-16bit;base64,…` URI because the provider cannot read a path on the desk.

Language is the desk's declaration either way: an explicit code is the provider's language hint, `auto` turns on the provider's language identification instead of omitting the field, and inverse text normalization stays off so digits inside product vocabulary are not rewritten. Normalization to Simplified Chinese, the shared display and agent transcript, and the safe failure vocabulary are unchanged.

A mocked request pins what was sent and what was accepted; it proves nothing about recognition accuracy, which needs measured audio and stays hardware acceptance. Silence, a wrong DirectShow device name or a wrong bearer must surface as the truthful failure, never as an invented transcript.
