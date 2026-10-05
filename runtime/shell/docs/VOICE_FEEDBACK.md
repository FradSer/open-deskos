# Voice feedback contract

The Personal Bot owns recording, transcription, execution and response. [PERSONAL_BOT_DEPLOYMENT](PERSONAL_BOT_DEPLOYMENT.md) owns host configuration. [Personal Bot README](../../../integrations/personal-bot/README.md) owns coordination and Hosted Pi operations.

## MIC and dismissal

| Feedback/state | MIC result |
| --- | --- |
| No current interaction | Start recording |
| Current interaction hidden | Restore its latest input/reply/state; do not toggle recording |
| Visible recording | Submit recording |
| Visible starting/submitting/transcribing/thinking | No operation |
| Visible completed/error | Start the next recording |

Back hides feedback without cancelling work. Background updates never reopen it. The renderer owns visibility and activation. Main routes MIC through preload for that decision; the main-owned recording IPC rejects busy states and duplicate pending toggles. Do not show Preparing for an already running request. Restore focus after dismissal and block underlying navigation while feedback is open.

A retry acknowledgement waits for the accepted operation to settle. An obsolete error must not clear the pending guard. Reconnection during hidden startup must not reopen feedback. Status queries and explicit transitions remain immediate.

## Recording

- Listening shows one microphone icon and one status line. A line below measures input amplitude; it is not speech probability or progress.
- Recording has no duration deadline. Manual MIC submits. Local WebRTC/libfvad WASM submits after about 1.2 seconds of classified silent audio after speech. Count audio frames, not callback gaps.
- Silence before speech keeps Listening active. Do not submit an empty turn.
- Stream audio to disk. Refuse uploads above 25,000,000 bytes with an explicit error. Do not truncate speech or store unbounded audio in memory.
- Provider transcription keeps its existing 45-second timeout. This differs from the recording lifetime.

## Transcript and streaming

Show normalized input above Working before execution output. Use literal text and a neutral microphone icon beside the first line. Keep the accessible name `Spoken input`; do not add a visible You label.

Show actual public assistant text as it arrives. Exclude thinking, tool arguments and raw results. Keep successful messages from the current request with blank-line separators. A discarded retry removes only its failed attempt's partial text; it must preserve successful earlier messages. Do not reuse a prior request as fallback.

Completion removes Working and retains input/reply until dismissal. A new recording clears both. Failure keeps input and explicit recovery text. Aborted, failed or exhausted overflow recovery is failure even if the SDK prompt promise resolves. A final `length` outcome without successful recovery cannot claim completion.

Follow new text only when the reader is already at the bottom. Preserve a manual reading position. Identical snapshots must retain reply DOM and scroll state. Hidden feedback stays hidden.

Replies use safe Markdown headings, lists, quotes, code and tables. Disable raw HTML and executable URLs. Links show labels/addresses as inert text. Images show alt text without loading assets. Preserve theme/type/geometry contracts.

## Status protocol

| Field/bound | Contract |
| --- | --- |
| `transcript` | Plain string, at most 4096 UTF-16 code units, with an explicit truncation notice |
| `message` | At most 16384 code units, with an explicit truncation notice |
| Frame | At most 131072 UTF-8 bytes, including worst-case JSON escaping |
| Publication | Coalesce streaming to about 10 Hz; publish transitions and final state immediately |

While thinking, `message` holds accumulated public text. Idle holds the completed response. Error holds safe recovery text. Validate types and bounds in the client. Reject callbacks for finished or replaced requests. Clear transcripts on new recording and shutdown. Remove timers and SDK subscriptions on every outcome.

## Language and provider contract

Use OpenCC to normalize validated transcripts to Simplified Chinese. Preserve Latin spelling, punctuation and identifiers. Display and agent prompt use the same normalized text. Agent replies default to Simplified Chinese unless the user selects another language. Do not guess recognition substitutions.

`ODESK_PERSONAL_BOT_STT_PROMPT` supplies or disables the recognition context. Limit it to 1024 UTF-16 code units. Default language is `zh`. Accept two/three-letter language codes; do not send unsupported `zh-CN` locale tags.

- Standard OpenAI-style recognition sends multipart audio. Omit language for `auto`.
- The known loopback whisper.cpp `/inference` endpoint requires explicit `auto`; omission selects its English default. Send `translate=false` only to that local contract.
- Aliyun/Qwen ASR sends inline WAV as `data:audio/wav;x-pcm-16bit;base64,…`. Context is a system message; omit it if empty. Explicit language supplies a hint; `auto` enables language identification. Keep inverse text normalization off so product digits are not rewritten.

Declare the provider; never infer it from a URL. A wrong credential, missing audio or wrong DirectShow device reports failure without an invented transcript. [ADR-0030](ARCHITECTURE.md#adr-0030) records the provider decision.

## Verification and limits

Use service/recorder tests for startup/shutdown, capture cleanup, fragmented PCM, backpressure, disk failure, VAD, bounds and manual/automatic submission races. Use the real socket for transcript-before-reply ordering, streaming-before-completion and maximum escaped frames. Use the Electron voice DOM for MIC restore, safe Markdown, focus, dismissal, scroll and theme/size geometry.

Run `node --test tests/personal-bot-client.test.js tests/voice-stream-integration.test.js` from the runtime. Run `pnpm exec electron tests/voice-input-ui.cjs`, `tests/personal-bot-status.cjs` and `tests/personal-bot-floating-panel.cjs` in the required graphical test session. Run the affected bot suite/typecheck from `integrations/personal-bot`. The full E2E result requires all required subprocesses to pass.

Fixtures do not prove acoustic accuracy, quiet speech/noise performance, Chinese/English recognition, CM5 CPU/GPU cost, physical MIC/Remote/touch or screen-reader announcements. Live capture, provider/model calls and deployment require authorization and separate host/device evidence. This contract adds no wake-word or speech-synthesis feature.
