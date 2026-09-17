# MIC restore and language correction verification

Scope: @runtime/linux/docs/VOICE_REOPEN_SPEC.md and @runtime/linux/docs/VOICE_LANGUAGE_SPEC.md. No deployment, commit or provider/hardware execution.

## Passed verification

- Runtime main routing, preload MIC subscription and renderer state matrix tests. Remote MIC dispatches an intent, never an unconditional toggle; hidden current interactions restore without capture, visible busy states do nothing, visible recording submits, visible completed/error begins next turn. Latest reply/input, scroll, focus, dismissal and rapid IPC behavior are covered.
- Actual Electron `tests/voice-input-ui.cjs` (three themes and three sizes), `tests/voice-status.cjs`, and floating panel regression.
- Final runtime `pnpm test` full suite.
- Final Voice Agent `pnpm test` full suite and `pnpm typecheck`, including real OpenCC conversion, mixed Latin/Chinese preservation, transcription prompt validation, startup wiring, local/standard auto semantics, and socket retry acknowledgement.
- Source syntax and scoped `git diff --check`.

## Independent reviews

Language audit found no blocking discrepancy. It verified installed opencc-js1.4.2 exports/types and ran39 scoped tests plus typecheck and actual converter probes. Its terminology note was corrected: the prompt limit is1024 UTF-16 code units, not Unicode code points. Language validation is syntactic; provider support still determines accepted language codes. English acoustic accuracy is not established by conversion or context tests.

Reopen review found two timing issues, corrected with regression evidence:

1. Retrying from an error could echo that obsolete error immediately, clearing main's pending guard. Socket toggle replies now wait for the accepted operation to settle, while transitions and explicit status queries remain immediate. Independent real-service/socket reproduction passed for deferred retry, unconfigured no-op and sanitized rejection.
2. Reconnection during hidden startup (`starting → Back → unavailable → idle → recording`) could reopen feedback. A new renderer regression failed before the fix; dismissal now clears only on explicit activation/new recording, not a background busy snapshot. The full16 scoped routing/preload/renderer tests and final real UI run pass afterward.

## Not accepted or not verified

`bash tests/smoke.sh` timed out in the default-size scenario during the worker run; no clean smoke claim. Real CM5 microphone/Remote behavior, STT model accuracy and assistive-technology announcements remain unverified. Neither changing models nor downloading models was performed. Prior unrelated shared-worktree changes remain untouched.
