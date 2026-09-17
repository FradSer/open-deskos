# Voice input and response

## Confirmed behavior

- Final Voice Agent replies render Markdown: headings, emphasis, lists, quotes, code blocks and tables. Untrusted HTML and unsafe links must not execute or navigate the Shell.
- Listening uses the same compact status heading as later stages: one microphone icon and one text line. A line underneath changes length with measured microphone input, not a decorative animation.
- Recording has no 30-second cutoff. Local voice activity detection on CM5 ends a spoken turn after approximately 1.2 seconds of classified silence. MIC still submits manually.
- Silence before any speech keeps Listening active and must not automatically submit an empty recording.
- Recording streams to disk rather than accumulating unbounded audio in memory. The transcription upload is bounded to 25,000,000 bytes; oversized recordings fail explicitly rather than silently truncating speech. This is a file-size limit, not a duration deadline.
- Replies are bounded to 16,384 characters with a visible truncation notice for longer replies, rather than the old 1,024-character summary; the socket accepts status frames up to 131,072 bytes to accommodate JSON escaping. Markdown links display their labels and destinations as inert text; images display alt text without loading assets.
- The local speech detector is WebRTC/libfvad running as bundled WASM; no remote VAD service, native addon build, or downloaded model is required. The 1.2-second endpoint counts classified silent audio frames after speech, not wall-clock gaps between process callbacks.
- Existing dismissal, focus restoration, blocked underlying navigation, themes and responsive scrolling remain intact.

## Verification seams

Use the resident VoiceService and recorder boundaries for lifecycle, VAD, cleanup, long recording and measured-level publication. Use the socket client boundary for validated level propagation. Use the actual Electron voice surface for Markdown semantics, unsafe input, changing line geometry, keyboard navigation, three themes and compact/native sizes.

## Out of scope

Wake words, speech synthesis, replacing transcription, hardware deployment, and claims of physical microphone/VAD accuracy without device acceptance.
