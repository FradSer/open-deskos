# Voice language correction

User reports Traditional Chinese output and inaccurate English terms. Normalize validated transcripts to Simplified Chinese with a maintained OpenCC converter, preserving Latin spelling, punctuation and identifiers. Both displayed input and the Agent prompt use the same normalized transcript. Agent replies default to Simplified Chinese unless the user explicitly requests another language.

For recognition, supply a short mixed-language transcription context containing actual product vocabulary; allow operator override or explicit disable with ODESK_VOICE_STT_PROMPT. Bound context length to1024 UTF-16 code units. Do not guess substitutions after transcription or claim proven recognition improvement from mocked tests.

Default language remains zh for Chinese-dominant speech. Accept language codes, not unsupported zh-CN locale tags. For the known loopback whisper.cpp /inference endpoint, auto must be sent explicitly; omission uses its English server default. Standard OpenAI-style transcription uses omission for auto. Keep local translate=false to avoid translating English content; don't send that local-only switch to other endpoints.

Verify real converter with mixed Traditional/Latin fixtures, multipart prompt/backend-specific auto contract, validation/error bounds and startup wiring. No model replacement, cloud migration, device deployment or real audio accuracy claim without separately measured hardware evidence.

Research: whisper.cpp v1.8.2 examples/server/server.cpp (`prompt` to initial_prompt, default language en); OpenAI transcription request language is ISO language code. opencc-js1.4.2 provides bundled pure-JavaScript t2cn conversion and declarations without native addons.
