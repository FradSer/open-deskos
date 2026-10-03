# A row states its session, not the pointer

## Status

Accepted. Refines ADR-0015's Session Overview list; supersedes the filled selection band that list was measured against.

## Context

A reader of the live list could not say why some rows were gray. Two different fills were in play at once: the pointer's own hover fill on whatever row it happened to rest on, and a `--odk-button` band on the current session. Neither stated a session. One was an accident of where the pointer stopped after a click, so the same list read differently depending on the operator's last gesture; the other spent a filled surface on a row that owns no surface, competing with the page's own cards and, across the split, with the Pi surfaces quoted inside the Session Detail.

## Decision

- **A row that is not the current session keeps the page's own surface.** Where the pointer rests is not a session state, so no row carries a hover fill. The list states what Pi reported and nothing about the cursor's history.
- **The current session is the only marked row, and the mark is a stroke.** One inset `1px` outline in `--odk-stroke-focus`, drawn inside the row's own box so no geometry moves when the selection moves. No fill: the row does not own a surface.
- **The focus ring stays its own ring.** `:focus-visible` keeps its 2px outline outside the row, so a keyboard reader meets focus and selection as two distinct marks rather than one ambiguous band.

## Consequences

- The list reads as one column of equal rows with a single hairline on the session the detail is showing. A pointer cannot invent a second candidate, and a screenshot of the list is evidence of the selection rather than of the last gesture.
- Selection is no longer carried by area, so it depends on the stroke's contrast against the page surface. A theme that lowers `--odk-stroke-focus` against its own background has to keep the mark legible or supersede this record.
- `tests/session-tabs-style.cjs` proves both halves and carries its own control: forcing `:hover` onto a non-selected row leaves its fill untouched while a filter tab's hover still answers, so the reading is not vacuous; and exactly one row carries the stroke, with no fill, while the others carry neither.
- The leading cursor element in the row markup stays unrendered. This record does not promote it to the selection mark, and the feature text that claimed one is corrected rather than implemented.
- The stroke is a page surface, so it stays on the DESIGN.md semantic tokens; the Pi Reading Palette still governs only quoted Pi content inside the Session Detail.
