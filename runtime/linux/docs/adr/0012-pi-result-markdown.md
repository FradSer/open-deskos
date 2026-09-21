# Pi result bodies support Markdown and tables

## Status

Accepted. Supersedes the first-line-only tool-result restriction in ADR-0005, ADR-0006, and ADR-0008. ADR-0015 extends this record: the bounded Markdown result body is kept, the retained window is now 300 events and 1 MiB per session, and every event kind keeps the multiline body Pi produced, bounded per kind, instead of the compact summaries decided here.

## Context

The operator needs the complete result rather than its first line, including Markdown tables. The previous contract discarded subsequent lines during extraction and reporting, so a renderer-only change could not satisfy the request.

## Decision

- A `result` event carries multiline Markdown in `text`, optional separate `toolName`, and an explicit `truncated: true` flag when bounded.
- Preserve every UTF-8 line within 64 KiB per result. Retain at most 60 recent events and 256 KiB of text/tool labels per session. Results exceeding the per-result limit display a visible truncation notice. This remains a bounded recent-event view, not an unbounded transcript archive.
- The local log collector reads a bounded 2 MiB tail, joins all text parts of one tool result, and applies the same result/retention limits as Desk Link.
- Desk Link accepts bounded event frames up to 1 MiB to carry these bodies; runtime replies remain limited to 2 MiB. Incoming streams decode UTF-8 across chunk boundaries.
- Use the already installed local `markdown-it` renderer. Raw HTML is disabled, links render as text/address, and images render as alternative text without loading remote assets.
- Render headings, paragraphs, lists, emphasis, code, quotes, and tables semantically. Result headings stay below the page title. Wide tables have a named, focusable horizontal scroll region; table arrow input never switches sessions or pages.
- Inherit semantic Shell colors and typography. Pixel uses Zpix without synthetic emphasis; underlining supplies emphasis. The existing Working auto-follow behavior remains in force.

## Consequences

- Both reporter and runtime must be updated; an old reporter that already discarded body text cannot be repaired by CSS.
- Plain text and Markdown remain readable when untrusted content contains HTML or link syntax, without executing it.
- Very large results are explicitly bounded. Retention may remove older events; the view does not claim complete session history.
- Images and binary tool-result parts are not transmitted or rendered by this text-only contract.
