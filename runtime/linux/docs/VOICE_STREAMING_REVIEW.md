# Voice transcript and streaming review

## Scope

@runtime/linux/docs/VOICE_STREAMING_SPEC.md. Current-request user transcript, actual assistant streaming, Working lifecycle and scroll behavior. Builds on the earlier local VAD/Markdown implementation; does not change recording, deployment or hardware contracts.

## Evidence

Feature-first failing regressions established missing transcript display and missing transcript transport. A cross-package test then exercised the actual resident VoiceService and Unix socket with the runtime client, proving input arrives before reply and partial text arrives before prompt completion.

Passed:
- `cd integrations/voice-agent && pnpm test && pnpm typecheck`: 102 tests and typecheck after terminal overflow corrections.
- `cd runtime/linux && node --test tests/voice-agent-client.test.js tests/voice-stream-integration.test.js`: four tests.
- Focused renderer Node test and `pnpm exec electron tests/voice-input-ui.cjs`, `tests/voice-status.cjs`, `tests/voice-floating-panel.cjs`: worker verified transcript/order, partial/final/error/new-turn states, dismissal, same-snapshot DOM identity and follow/preserve scrolling; three themes and three sizes in the input harness.
- Scoped JavaScript syntax, release composition and diff whitespace checks.
- Scoped CSS detector returned no findings.
- Complete `pnpm e2e` ran the updated voice gate successfully, including the final completion-scroll assertion. Overall E2E failed only the `interiors` sub-suite (status1); driver, motion, sweep, sequential, all six density runs and all four theme/voice runs passed. A separate `widget-app-styles.cjs` rerun isolated the failure to the obsolete “vision Widgets retain visible identities” assertion during the concurrent removal of those widgets. Overall E2E is not claimed green.

One overflow-retry aggregation bug was found during implementation: a failed message not added to completed text could incorrectly remove preceding successful narration. A regression demonstrated it and the adapter now removes only a successfully appended length-truncated attempt when the SDK discards it for overflow recovery.

A runtime full test run during concurrent P4 face-feature removal passed236/245, with nine failures referencing that other session's changing P4/Face APIs and fixtures. Those tests were not modified by the voice work. A later complete runtime `pnpm test` rerun passed after the parallel changes advanced.

Smoke was not accepted as clean: two worker `pnpm smoke` runs exited0 but printed both a timeout failure record and a later native-size success record. No claim of clean smoke acceptance is made for this revision.

## Independent audit

Standards axis passed the scoped source/test audit. Spec audit found terminal overflow compaction failures could resolve the SDK prompt normally after a length-truncated assistant message, causing false idle success. Corrected after feature-first adapter/service failures proved false idle success. The adapter now handles aborted/error overflow outcomes without retry, rejects the request, and lets the service retain input with safe failure text. Normal recovery and successful maintenance remain passing. Leader reran31 adapter/service tests, typecheck and six runtime client/integration/UI Node tests after correction; all passed. A second isolated reviewer verified emitted terminal failures but found an SDK path where recovery fails before starting and emits no compaction event. A new failing adapter regression proved unresolved final `length` was still accepted. The result gate now rejects a final `length` even without recovery events; a subsequent successful retry still clears it via its successful terminal message. Final full102 backend tests and typecheck pass. Both review counterexamples have corresponding regression coverage.

## Transcript marker refinement

Removed the visible “You” label at the user's request. A neutral20px microphone icon sits beside the first transcript line, rather than adding a label row. The SVG is decorative (`aria-hidden`), and its group retains the accessible name “Spoken input”. The real Electron regression first failed on the old label, then passed across three themes and three sizes; six scoped voice Node tests, token parity, syntax and release validation also passed. The Listening icon assertion now checks rendered client rectangles, so an SVG inside a hidden transcript group is not mistaken for visible content.

## Boundaries

Input uses literal text and is separate from response Markdown. Internal thinking and raw tool records are not shown. Existing safe Markdown policy remains. Stream publication is coalesced to100ms, with immediate state transitions and final response; closed/finished requests reject late callbacks. Initial recording/shutdown clears the transcript. Snapshot bounds remain4096 transcript and16384 reply characters, within131072-byte frames including worst-case JSON escaping.

Not verified: live LLM/provider streaming, physical microphone, CM5 GPU/touch and actual screen-reader announcements. No deployment or commit was requested or performed by this change.
