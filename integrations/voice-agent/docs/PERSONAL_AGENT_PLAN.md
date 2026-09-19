# Personal voice assistant and DiDi acceptance plan

## Confirmed scope

The owner requested configurable Skills, private MEMORY.md, and a working ride-hailing agent. They explicitly approved CM5 voice-service deployment/restart, but no real ride creation during development. Sandbox transactions are allowed for verification. Do not publish credentials or change the concurrent Shell work.

## User outcomes

- Speak to the existing MIC interface and receive truthful personal-assistant responses.
- Configure reviewed local Skills without enabling arbitrary extensions or shell execution.
- Explicitly remember, inspect, and forget personal notes across service restarts.
- Search current POIs, choose exact endpoints, see prices, and explicitly confirm a selected ride.
- Query, track, and explicitly cancel rides; never create duplicates after uncertain delivery.
- Keep programming in the existing coding profile rather than granting the personal assistant unrestricted filesystem/network execution.

## Boundaries and tests

Use existing SDK resource loader/session adapter and VoiceService seams. Add mock-transport tests at the ride controller boundary for confirmation, persistence, expiry, uncertainty, recovery and polling. Add profile/memory tests for allowlisting, private persistence, explicit write grants and bounded context. Integration tests cover raw accepted transcript authorization, grant cleanup, personal tool isolation, asynchronous ride notifications and safe failure messages.

Executable scenarios live in ../features/personal-agent.feature, ../features/didi.feature and ../features/personal-integration.feature. Run feature-first RED/GREEN scoped tests, then full voice tests/typecheck and affected deployment contracts. Fresh security review is required before deployment. Sandbox live verification is separate from offline tests. Check service startup and model/agent operation on device; physical microphone/STT requires actual user speech and must not be claimed from a text probe.

## Decisions

- Reuse Pi SDK and existing recording/STT/socket/feedback, not phone UI automation.
- Personal profile has custom allowlisted tools only; no native read/bash/write/edit or arbitrary capability modules.
- Long-term memory is opt-in user data, never authorization. Conversation history and ride transaction state are distinct stores.
- A host-observed exact subsequent confirmation phrase gates each mutation. Model-generated booleans cannot authorize orders.
- Sandbox and production use separate order state. A submitting/unknown state blocks another create; reconcile before further mutations.
- Deploy a separately staged voice bundle with a reversible user service override; do not activate unrelated Shell changes.

## Out of scope

TTS, wake word, phone UI automation, unattended purchases, real ride acceptance during development, and publishing changes externally. No commit requested.
