# Pi Sessions controls live on the Remote Control Strip

## Status

Accepted, except the title-row decision, which ADR-0007 supersedes.

## Context

The Pi Sessions page was a multi-session monitor: a search field, a Refresh button, running/settled/workspace metric pills, a workspace-grouping toggle, and a status filter group, all on the screen, with the data source named under the title. The required interaction is now a Session Switcher — the page shows one session at a time and the Remote Control moves between them. A screen full of list controls contradicts a single-session view, and the ESP32-S3 Remote Control already owns a contextual Touch Bar that presents authoritative page state.

## Decision

- The Pi Sessions page renders one Session Detail at a time. Its title row carries no search field, no Refresh button, no metric pills, no workspace-grouping toggle, and no data-source label under the title. _(Superseded by ADR-0007: the title row does carry the global session controls.)_
- The Session Filter owns the Session Set that the Session Switcher and the Session Overview share. It defaults to Working and is transient — it does not survive a shell restart.
- The Pi status-bar indicator keeps reporting Running Sessions regardless of the Session Filter: a persistent system indicator must not change meaning with a transient page filter.
- The Remote Control Strip carries two Pi Sessions buttons: one Session Filter button whose label is the current filter value and which advances to the next filter on press, and one Session Overview button that opens the grid.
- A page publishes its own strip buttons as its authoritative state rather than declaring them in `desktop_layout.js`, so the filter button label tracks the live filter value.
- The Session Overview is the screen-side home of the Session Filter and the screen-side way to choose a session. Touchscreen and keyboard reach the filter only through it.
- Data-source provenance leaves the Session Detail. It remains in the Session Overview header, in unavailable-state copy, and in the Pi status-bar indicator's accessible name.
- Session Detail events come from a dedicated on-demand endpoint that reads the bounded tail of one session log. The session scan stays lightweight so the widget, the status indicator, and the Session Overview do not pay for transcript reads.

## Consequences

- The Refresh control disappears, so a failed scan has no manual retry. Recovery is automatic polling, and the unavailable state must name the source and must not instruct the user to press a button that no longer exists.
- Provenance is no longer visible beside a single session's detail; a wrong-source reading is corrected by opening the Session Overview rather than by reading the page header.
- The Touch Bar renders at most four actions. This design uses two, leaving room for a later page-owned button without a firmware limit change.
- Full tool-result bodies are deliberately never rendered; a Session Detail reports one bounded line per Session Event.
- Session Events are read only from the local machine's own session logs. A Mac over SSH source has no Session Detail event stream yet, so that source must state that it provides none rather than render an empty successful stream; remote events are a separate follow-up issue.

## Considered options

- Keeping the filter group on the screen title row was rejected because it contradicts the single-session view and duplicates a state the Remote Control already publishes. **Reversed by ADR-0007** after the running page showed that a two-step, hidden filter cost more than the duplicated state.
- Rendering the Session Overview on the 240x320 Remote Control was rejected: a grid cell would be roughly 50x40 pixels and unreadable.
- Carrying each session's events inside the regular scan result was rejected: it would read every session log on every poll for surfaces that never display events.