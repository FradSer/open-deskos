# Voice input and response verification

## Scope

Working changes to the Shell voice feedback surface and resident Voice Agent: Markdown replies, measured input level, local speech endpointing and removal of the 30-second recording cutoff. Framework-free Electron DOM, existing `--odk-*` tokens and Instrument/Pixel/Border Beam themes. Product and standards: @PRODUCT.md, @DESIGN.md, @runtime/linux/AGENTS.md, @runtime/linux/docs/VOICE_INPUT_SPEC.md.

Lockfiles and generated `uno.css` were excluded from visual review. Neighboring Widget/App styles and density were checked for regressions. Peripheral firmware and deployment are outside this change.

## Interface review

| Domain | Evidence | Result |
| --- | --- | --- |
| Accessibility | Existing voice focus/Back/keyboard/touch tests; meter outside the live region; reduced-motion processing indicator | No introduced finding; physical screen-reader behavior not verified |
| Layout | Real Electron geometry at 1920×1280, 480×854 and 320×480; long CJK, code and tables | No panel horizontal overflow in tested fixtures |
| Writing | One Listening label; explicit recovery and upload-limit messages; response truncation notice | No actionable finding |
| Typography | Native/compact type floors; parsed headings/emphasis; Pixel underline emphasis without synthetic styles | No actionable finding |
| Colors | Existing semantic tokens only; token smoke gate | No introduced palette changes; no new rendered contrast measurement |
| UI | Real input-level growth/reset; one microphone icon; no fake recording loop; unchanged floating surface and dismissal | No actionable finding |

An entity/escaped-punctuation issue in the plain-text Markdown optimization was found during implementation, reproduced with a failing regression and corrected before final verification.

## Passed checks

- `cd integrations/voice-agent && pnpm test` — 84 tests passed.
- `cd integrations/voice-agent && pnpm typecheck`.
- `cd runtime/linux && pnpm test` — 258 tests passed in the serial run.
- `pnpm styles`, `pnpm smoke`, and `bash tests/smoke.sh` in the runtime.
- `pnpm exec electron tests/voice-input-ui.cjs` — Markdown semantics/security, real meter geometry, three themes and three sizes, hidden offscreen window.
- `pnpm exec electron tests/voice-floating-panel.cjs` and `pnpm exec electron tests/voice-status.cjs`.
- `pnpm exec electron tests/widget-app-styles.cjs` and `pnpm exec electron tests/widget-density.cjs`.
- `pnpm e2e` — full sequential suite including the new recurring voice-input regression.
- Runtime composition and dependency validation; `node --check` for changed Shell/client/release JavaScript; `git diff --check`.
- Scoped Impeccable detector on `src/renderer/voice-status.css` returned an empty findings list.

During concurrent Electron checks, three user-app verifier tests timed out; all passed on serial rerun. An earlier full runtime run intentionally encountered the new Listening regression while its implementation was still RED.

## Not verified

No CM5 deployment, real microphone capture, physical touch acceptance, screen-reader session, provider credentials or live transcription/LLM calls were performed. The bundled WebRTC WASM was exercised locally for silence; endpoint timing and continuous input were tested through the recorder seam with deterministic speech classification. Quiet speech, room noise, Chinese utterance accuracy and CM5 CPU cost remain device acceptance work. Existing 45-second transcription timeout remains; recording itself has no time deadline. Uploads retain an explicit 25,000,000-byte resource limit.

## Standards audit

Independent read-only review found no confirmed introduced standards violations or actionable design/slop smells. It inspected the changed renderer, release validator, socket client, recorder, VAD, service, transport, transcription and adapter, including new files. Its strongest counterexample was executable Markdown: nine adversarial parser probes covering raw HTML, unsafe schemes, attribute injection, images, autolinks and fenced code emitted no executable elements or event attributes. Focus handling, semantic tokens and Pixel emphasis were also inspected. Standards axis: PASS within the inspected scope.

## Spec audit

Independent read-only review passed the changed voice-input behavior. It challenged shutdown during unresolved capture startup, concurrent manual/automatic submission, fragmented PCM, backpressure, disk errors, maximum escaped status frames, nested Markdown and unsafe URLs. No actionable introduced implementation defect was established. Spec axis: PASS for this change.

One nonblocking pre-existing mismatch remains: `integrations/voice-agent/features/voice.feature` still contains historical live-session control scenarios despite the separately completed move to managed coding tasks. Those scenarios were not restored or changed as part of voice input; the managed-task README and implementation remain authoritative for that separate capability.

## Verdict

Standards: 0 unresolved findings. Changed spec: 0 unresolved findings; 1 pre-existing documentation mismatch outside this change. No actionable introduced interface findings in the inspected scope. Host verification does not establish hardware acceptance.
