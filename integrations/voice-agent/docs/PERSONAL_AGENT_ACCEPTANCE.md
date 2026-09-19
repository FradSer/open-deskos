# Personal assistant acceptance — 2026-09-17

## Scope and authorization

Owner approved full implementation and CM5 voice-only deployment/restart. No production order creation/cancellation was authorized or performed. Credential values are excluded from this record.

## Verification

- Local `cd integrations/voice-agent && pnpm test`: 151 passed.
- Local `pnpm typecheck`: passed; includes nested DiDi modules.
- Runtime affected voice/deployment/client/stream tests: 23 passed.
- CM5 targeted personal/DiDi/notification tests: 38 passed before the final 30-second fallback scheduling regression fix; that fix subsequently passed the full local suite.
- CM5 staged typecheck: passed.
- Fresh independent security reviews found inherited APPEND_SYSTEM context, malformed status/identity handling, whole-connect deadline gap and fallback polling interval; each received a failing regression and fix. Final core review verified transaction boundaries and real SDK mocked SSE compatibility. No critical/high finding remained in its reviewed snapshot.

## Live checks

- Sandbox live POI search: returned 10 results.
- Sandbox quote: returned four products.
- Sandbox submit before a subsequent confirmation: blocked.
- Sandbox submit after synthetic acceptance confirmation: created a simulated order.
- Sandbox query differs from documentation: only text content, no structuredContent. Verified fallback retains identity, displays informational text, stays unknown and blocks duplicate creation. Did not claim structured live lifecycle completion.
- Production read-only search: connected, returned 11 POIs. No production order/charge/payment test.
- Device Pi model probe: personal agent loaded the reviewed DiDi skill and accurately described endpoint clarification, estimation and subsequent exact confirmation phrase. No mutation performed by this model probe.

## Activated device state

- Service: `open-deskos-voice-agent.service`, active/running.
- Voice-only bundle: `~/.local/share/open-deskos/voice-releases/personal-20260917/`.
- Drop-in: `~/.config/systemd/user/open-deskos-voice-agent.service.d/personal-agent.conf`.
- Config: `~/.config/open-deskos/personal-agent.json`, production environment.
- Private key: `~/.config/open-deskos/didi.key`, mode 0600.
- Memory: `~/.local/state/open-deskos-voice/personal/MEMORY.md`, mode 0600, initialized empty.
- Voice env rollback copy: `~/.config/open-deskos/voice-agent.env.before-personal-20260917`.
- Private status socket: returned idle, empty feedback, no retained transcript.
- Production ride state: idle, no order, sandbox=false.
- Shell release selection unchanged.

## Remaining acceptance

Physical MIC/STT must be exercised by the owner speaking to the device. Production order, cancellation, payment and driver progression require an explicitly confirmed real trip; they were not tested. Text-only remote status never releases the money guard, so manual DiDi-app reconciliation may be required. No TTS or wake word was added. No commit requested or created.
