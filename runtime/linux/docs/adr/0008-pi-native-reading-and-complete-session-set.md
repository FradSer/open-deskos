# Pi-native reading and a complete reported Session Set

## Status

Accepted. Supersedes ADR-0005's Working default and grid presentation of the Overview; preserves ADR-0007's title-row controls. ADR-0012 supersedes this record's first-line-only result limit.

## Context

The operator asked for the fourth page to resemble native Pi while respecting Instrument, Pixel, and Border Beam. They also reported seeing one session while several working and non-working sessions existed.

Two independent causes obscured the set: Working was the initial filter, and the Desk Link Service treated each process's snapshot as the whole machine's snapshot. Two processes sharing a machine identity therefore overwrote one another. A connection is the ownership boundary, not a machine name.

## Decision

- Start the transient Session Filter at All. The title row shows counts for All, Working, Settled, and Exited. The State Bar retains its independent running-session count.
- Keep one Session Detail with bounded recent event summaries, never claim a complete transcript or tool-result body.
- Borrow native Pi's reading hierarchy: neutral user bands, plain assistant text, quieter thinking/result summaries, and compact tool headings. Do not invent execution success or failure from an event kind. Keep role identification available to assistive technology without a repeated visible label column.
- Present the Overview as a single-column session chooser with goal-first rows, workspace/state metadata, and a visible selection cursor. Keep 44px controls and wrapping English/CJK text. No search or fabricated token/model metrics are added.
- Keep Overview as a page-local cover over the mounted Session Detail. It does not replace the page or become a whole-Shell modal. The title controls remain available. Back returns without choosing; choosing returns to the selected detail.
- Direct previous/next controls and focused-detail arrow keys switch sessions without paging the Shell. Remote bounds and page-chrome navigation remain unchanged.
- Each authenticated Desk Link replaces only its own reported sessions. The machine snapshot is the bounded union of connected reporters; dropping one connection cannot erase another's sessions or leave a disconnected-only working session falsely live.

## Consequences

- Native Pi's structural hierarchy is retained, while colors, typography, focus, and outer-surface treatment come from `DESIGN.md`, not Pi's literal terminal palette.
- Periodic refresh retains selection identity and Overview buttons/focus. Reapplying the active filter is a no-op. Switching identity clears old events before requesting the new stream.
- A Working session always follows the newest event at the bottom, including after scrolling or resizing, and its scrollbar stays visible. Settled and Exited sessions retain their manual reading position.
- The service fix does not invent sessions absent from all reporters. Existing-session discovery belongs to the reporting package and must retain its own bounds and provenance.
- Verification uses hidden, isolated CM5 processes. Headless geometry does not establish physical touch, GPU rendering, screen-reader, or live-release acceptance.
