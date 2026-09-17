# Voice transcript and streaming reply

## Confirmed behavior

After transcription succeeds, immediately show the recognized user input above Working. The input is plain text, not Markdown. A small neutral microphone icon sits beside its first line instead of a visible “You” label; the input group retains an accessible name. Show actual assistant text as it arrives, rendered with the existing safe Markdown renderer below Working; never simulate streaming from a finished response. Do not show internal thinking, tool arguments or raw tool results. Retain public assistant text across successful messages within the current request, separated by blank lines. Retries remove the failed attempt's partial text instead of presenting it as a result; successful earlier messages remain. Never read prior-request replies as fallback output. At completion remove Working/progress and keep input and response until dismissed. Starting another request clears both. On failure retain the input and show explicit recovery rather than presenting partial output as success. Failed, cancelled or exhausted context-overflow recovery is failure even if the SDK prompt promise resolves normally; length-truncated attempts must not masquerade as completed output.

Keep existing microphone/VAD behavior, modal input shielding, dismissal and focus restoration. Stream updates must not reopen dismissed feedback. If the reader scrolls up, incoming output must not pull them to the bottom; if already at the bottom, follow new content. Repeated identical snapshots must not rebuild the reply DOM or reset scrolling.

## Protocol

Keep existing status states. Add `transcript` (plain string, bounded to 4096 UTF-16 code units with an explicit truncation notice when required). While thinking, `message` carries the accumulated visible assistant text; idle carries completed text; error carries safe recovery text. Message remains bounded to16384 code units, with the existing truncation notice. Both fields fit the131072-byte JSON frame even at worst-case escaping. New recordings and shutdown clear the transcript. Socket client validates types/bounds; late callbacks cannot affect finished/new requests. Publish coalesced streaming snapshots (~10Hz maximum) plus immediate state changes and final response; clean pending timers and SDK subscriptions on every outcome.

## Verification

Feature-first regression tests through sessionAdapter event subscription, VoiceService and socket client, then real Electron DOM assertions for input/Working/partial/final/error/new-turn/dismissed states, Markdown safety, scroll follow/preservation and compact geometry. Existing complete runtime and voice backend suites remain gates. No deployment, actual LLM/provider call or hardware acceptance in scope.
